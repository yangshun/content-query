import { createProcessor } from "@mdx-js/mdx";
import type { Expression, Pattern, Program } from "estree";
import type { Root, RootContent } from "mdast";
import type { Root as HastRoot } from "hast";
import type { PluggableList, Plugin } from "unified";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMdx from "remark-mdx";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import { toString } from "hast-util-to-string";
import GithubSlugger from "github-slugger";
import { VFile } from "vfile";
import { SourceMapGenerator } from "source-map";
import { createHighlighter } from "shiki";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import rehypeShiki from "@shikijs/rehype/core";
import type { ContentHeading } from "content-query";
import type { HydrationStrategy } from "./types.ts";

type JsxNode = Extract<RootContent, { type: "mdxJsxFlowElement" | "mdxJsxTextElement" }>;
type JsxAttribute = Extract<JsxNode["attributes"][number], { type: "mdxJsxAttribute" }>;
/** A statically identifiable component import, independent of bundler module IDs and asset URLs. */
export type MdxIslandReference = {
  source: string;
  imported: string;
  local: string;
  strategy: HydrationStrategy;
  filePath: string;
  line: number;
  column: number;
};
/** Shared compiler configuration; build integrations supply reference resolution without leaking into core. */
export type MdxCompileOptions = {
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
  highlight?: boolean;
  target?: "react" | "islands";
  resolveMdxImport?(specifier: string, target: "react" | "islands"): string | Promise<string>;
  resolveIsland?(
    reference: MdxIslandReference,
  ): Promise<{ id: string; clientOnlyImport?: string }> | { id: string; clientOnlyImport?: string };
};
/** Authored input; paths provide import bases, source maps, and actionable diagnostics. */
export type MdxFile = { value: string; path: string };
/** Parsed source reusable across compilation targets without rerunning author transforms. */
export type MdxAnalysis = { tree: Root; islands: MdxIslandReference[]; file: MdxFile };
let highlighting: ReturnType<typeof createHighlighter> | undefined;

/** Checks declaration patterns without treating object keys as exported bindings. */
function bindsHeadings(pattern: Pattern): boolean {
  switch (pattern.type) {
    case "Identifier":
      return pattern.name === "headings";
    case "ObjectPattern":
      return pattern.properties.some((property) =>
        bindsHeadings(
          property.type === "RestElement" ? property.argument : (property.value as Pattern),
        ),
      );
    case "ArrayPattern":
      return pattern.elements.some((element) => element !== null && bindsHeadings(element));
    case "AssignmentPattern":
      return bindsHeadings(pattern.left);
    case "RestElement":
      return bindsHeadings(pattern.argument);
    default:
      return false;
  }
}

/** Shares successful initialization while permitting a later attempt after transient setup failures. */
function highlighter() {
  if (!highlighting) {
    const pending = createHighlighter({
      engine: createJavaScriptRegexEngine(),
      themes: ["github-light", "github-dark"],
      langs: ["javascript", "typescript", "tsx", "jsx", "json", "css", "html", "bash", "markdown"],
    }).catch((cause: unknown) => {
      if (highlighting === pending) {
        highlighting = undefined;
      }
      throw cause;
    });
    highlighting = pending;
  }
  return highlighting;
}

/** Builds a single expression attribute with the ESTree representation MDX expects. */
function expressionAttribute(name: string, expression: Expression): JsxAttribute {
  return {
    type: "mdxJsxAttribute",
    name,
    value: {
      type: "mdxJsxAttributeValueExpression",
      value: "",
      data: {
        estree: {
          type: "Program",
          sourceType: "module",
          body: [{ type: "ExpressionStatement", expression }],
        },
      },
    },
  };
}

/** Represents an explicitly imported JSX member path as an ordinary JavaScript expression. */
function bindingExpression(name: string): Expression {
  const [root, ...members] = name.split(".");
  let expression: Expression = { type: "Identifier", name: root! };
  for (const member of members) {
    expression = {
      type: "MemberExpression",
      object: expression,
      property: { type: "Identifier", name: member },
      computed: false,
      optional: false,
    };
  }
  return expression;
}

/** Creates a compiler-owned import while preserving all unrelated authored imports and exports. */
function importNode(source: string, local: string, imported?: string): RootContent {
  return {
    type: "mdxjsEsm",
    value: "",
    data: {
      estree: {
        type: "Program",
        sourceType: "module",
        body: [
          {
            type: "ImportDeclaration",
            attributes: [],
            source: { type: "Literal", value: source },
            specifiers: [
              imported
                ? {
                    type: "ImportSpecifier",
                    local: { type: "Identifier", name: local },
                    imported: { type: "Identifier", name: imported },
                  }
                : { type: "ImportDefaultSpecifier", local: { type: "Identifier", name: local } },
            ],
          },
        ],
      },
    },
  };
}

/** Checks direct directives and records their import identities after author remark transforms. */
export async function analyzeMdx(
  file: MdxFile,
  options: Pick<MdxCompileOptions, "remarkPlugins"> = {},
): Promise<MdxAnalysis> {
  const input = new VFile(file);
  const parser = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(options.remarkPlugins ?? []);
  const tree = (await parser.run(parser.parse(input), input)) as Root;
  const imports = new Map<string, { source: string; imported: string }>();
  for (const node of tree.children) {
    if (node.type !== "mdxjsEsm") {
      continue;
    }
    for (const statement of node.data?.estree?.body ?? []) {
      if (
        statement.type === "ExportAllDeclaration" &&
        statement.exported &&
        (statement.exported.type === "Identifier"
          ? statement.exported.name
          : statement.exported.value) === "headings"
      ) {
        input.fail(
          'MDX reserves the "headings" export for generated heading metadata. Rename the authored export.',
          node,
        );
      }
      if (statement.type === "ExportNamedDeclaration") {
        const declaration = statement.declaration;
        if (
          statement.specifiers.some(
            (specifier) =>
              (specifier.exported.type === "Identifier"
                ? specifier.exported.name
                : specifier.exported.value) === "headings",
          ) ||
          (declaration?.type === "VariableDeclaration" &&
            declaration.declarations.some((item) => bindsHeadings(item.id))) ||
          ((declaration?.type === "FunctionDeclaration" ||
            declaration?.type === "ClassDeclaration") &&
            declaration.id?.name === "headings")
        ) {
          input.fail(
            'MDX reserves the "headings" export for generated heading metadata. Rename the authored export.',
            node,
          );
        }
      }
      if (statement.type !== "ImportDeclaration") {
        continue;
      }
      for (const specifier of statement.specifiers) {
        const imported =
          specifier.type === "ImportDefaultSpecifier"
            ? "default"
            : specifier.type === "ImportNamespaceSpecifier"
              ? "*"
              : specifier.imported.type === "Identifier"
                ? specifier.imported.name
                : specifier.imported.value;
        imports.set(specifier.local.name, {
          source: String(statement.source.value),
          imported: String(imported),
        });
      }
    }
  }
  const islands: MdxIslandReference[] = [];
  visit(tree, (node) => {
    if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") {
      return;
    }
    const directives = node.attributes.filter(
      (attribute): attribute is JsxAttribute =>
        attribute.type === "mdxJsxAttribute" && attribute.name.startsWith("client:"),
    );
    if (!directives.length) {
      return;
    }
    const directive = directives[0]!;
    const strategy = directive.name.slice(7);
    if (directives.length !== 1 || !["load", "visible", "idle", "only"].includes(strategy)) {
      input.fail("Use exactly one supported client directive: load, visible, idle, or only.", node);
    }
    if (directive.value !== null && !(strategy === "only" && directive.value === "react")) {
      input.fail(
        'Client directives currently take no options; client:only may also specify "react".',
        node,
      );
    }
    const [local, ...members] = (node.name ?? "").split(".");
    const binding = imports.get(local!);
    if (!binding || (binding.imported === "*" && !members.length)) {
      throw input.message("Hydrated MDX widgets must be explicitly imported components.", node);
    }
    if (node.children.some((child) => child.type !== "text")) {
      input.fail(
        "Islands accept data props and text children. Move formatted children or nested islands into the imported widget.",
        node,
      );
    }
    islands.push({
      source: binding.source,
      imported: [binding.imported === "*" ? "" : binding.imported, ...members]
        .filter(Boolean)
        .join("."),
      local: node.name!,
      strategy: strategy as HydrationStrategy,
      filePath: file.path,
      line: node.position?.start.line ?? 1,
      column: node.position?.start.column ?? 1,
    });
  });
  return { tree, islands, file };
}

/** Collects live imported bindings after client-only references have been replaced. */
function liveBindings(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) {
      liveBindings(child, result);
    }
  } else if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    if (node.type === "ImportDeclaration") {
      return result;
    }
    if (node.type === "Identifier" && typeof node.name === "string") {
      result.add(node.name);
    }
    if (
      (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
      typeof node.name === "string"
    ) {
      result.add(node.name.split(".")[0]!);
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== "position") {
        liveBindings(child, result);
      }
    }
  }
  return result;
}

/** Compiles one analyzed source into normal React ESM or an isolated standalone-islands target. */
export async function compileAnalysis(analysis: MdxAnalysis, options: MdxCompileOptions = {}) {
  const input = new VFile(analysis.file);
  const tree = structuredClone(analysis.tree);
  tree.children = tree.children.filter((node) => node.type !== "yaml");
  const resolutions = await Promise.all(
    analysis.islands.map(async (reference) => ({
      reference,
      resolved: await options.resolveIsland?.(reference),
    })),
  );
  const additions: RootContent[] = [];
  const onlyBindings = new Set<string>();
  for (const node of tree.children) {
    if (node.type !== "mdxjsEsm") {
      continue;
    }
    for (const statement of node.data?.estree?.body ?? []) {
      if (
        (statement.type === "ImportDeclaration" ||
          statement.type === "ExportNamedDeclaration" ||
          statement.type === "ExportAllDeclaration") &&
        statement.source &&
        typeof statement.source.value === "string" &&
        statement.source.value.endsWith(".mdx") &&
        options.resolveMdxImport
      ) {
        statement.source.value = await options.resolveMdxImport(
          statement.source.value,
          options.target ?? "react",
        );
        delete statement.source.raw;
      }
    }
  }
  let next = 0;
  if (options.target === "islands" && resolutions.length) {
    additions.push(importNode("@content-query/mdx/react/server", "__cq_Island", "Island"));
  }
  visit(tree, (node) => {
    if (node.type !== "mdxJsxFlowElement" && node.type !== "mdxJsxTextElement") {
      return;
    }
    if (
      !node.attributes.some(
        (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name.startsWith("client:"),
      )
    ) {
      return;
    }
    const index = next++;
    const { reference, resolved } = resolutions[index]!;
    node.attributes = node.attributes.filter(
      (attribute) => attribute.type !== "mdxJsxAttribute" || !attribute.name.startsWith("client:"),
    );
    if (reference.strategy === "only") {
      onlyBindings.add(reference.local.split(".")[0]!);
    }
    if (options.target === "islands") {
      if (!resolved) {
        throw input.message(
          "Island compilation requires an import resolver from the host integration.",
          node,
        );
      }
      node.name = "__cq_Island";
      node.attributes.push(
        { type: "mdxJsxAttribute", name: "__cq_id", value: resolved.id },
        { type: "mdxJsxAttribute", name: "__cq_strategy", value: reference.strategy },
        {
          type: "mdxJsxAttribute",
          name: "__cq_source",
          value: `${reference.filePath}:${reference.line}:${reference.column}`,
        },
      );
      if (node.type === "mdxJsxTextElement") {
        node.attributes.push(expressionAttribute("__cq_inline", { type: "Literal", value: true }));
      }
      if (reference.strategy !== "only") {
        node.attributes.push(
          expressionAttribute("__cq_component", bindingExpression(reference.local)),
        );
      }
    } else if (reference.strategy === "only") {
      if (!resolved?.clientOnlyImport) {
        throw input.message(
          "client:only requires a host integration that generates a browser-only component boundary.",
          node,
        );
      }
      const name = `__cq_Only${index}`;
      additions.push(importNode(resolved.clientOnlyImport, name));
      node.name = name;
    }
  });
  const used = liveBindings(tree);
  for (const node of tree.children) {
    if (node.type === "mdxjsEsm" && node.data?.estree) {
      node.data.estree.body = node.data.estree.body.filter((statement) => {
        if (statement.type !== "ImportDeclaration" || !statement.specifiers.length) {
          return true;
        }
        statement.specifiers = statement.specifiers.filter(
          (specifier) => !onlyBindings.has(specifier.local.name) || used.has(specifier.local.name),
        );
        return statement.specifiers.length > 0;
      });
    }
  }
  tree.children.unshift(...additions);
  const headings: ContentHeading[] = [];
  /** Assigns heading IDs after author rehype plugins so the exported TOC matches rendered headings. */
  const headingPlugin: Plugin<[], HastRoot> = () => (root) => {
    const slugger = new GithubSlugger();
    visit(root, "element", (node) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        const text = toString(node);
        const slug =
          typeof node.properties.id === "string" ? node.properties.id : slugger.slug(text);
        node.properties.id = slug;
        headings.push({ depth: Number(node.tagName.slice(1)), slug, text });
      }
    });
  };
  const rehypePlugins: PluggableList = [...(options.rehypePlugins ?? []), headingPlugin];
  if (options.highlight !== false) {
    const initialized = await highlighter();
    rehypePlugins.push(() =>
      rehypeShiki(initialized, {
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: "light",
        fallbackLanguage: "text",
      }),
    );
  }
  const processor = createProcessor({
    development: false,
    outputFormat: "program",
    SourceMapGenerator,
    rehypePlugins,
  });
  // MDX's run declaration describes its output tree; its actual pipeline begins with mdast.
  const program = await processor.run(tree as unknown as Program, input);
  const code = String(processor.stringify(program, input));
  let metadata = "__cq_headings";
  while (code.includes(metadata)) {
    metadata += "_";
  }
  return {
    code: `${code}\nconst ${metadata} = ${JSON.stringify(headings)};\nexport {${metadata} as headings};\n`,
    map: input.map,
    headings,
    islands: analysis.islands,
  };
}

/** Compiles MDX without importing a bundler, evaluating a component, or creating React roots. */
export async function compileMdx(file: MdxFile, options: MdxCompileOptions = {}) {
  return compileAnalysis(await analyzeMdx(file, options), options);
}
