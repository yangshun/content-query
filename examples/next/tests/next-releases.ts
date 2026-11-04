import { readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The example application directory. */
export const appRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const dependencies = path.join(appRoot, "node_modules");

/** A bundler that Next.js can compile the example with. */
export type Bundler = "turbopack" | "webpack";

/** A Next.js release installed for the example under its own package name. */
export type NextRelease = {
  /** Installed package directory, such as `next` or the `next-15.0` alias. */
  packageName: string;
  /** Exact installed version. */
  version: string;
  /** Major version, which decides the bundler command-line flags. */
  major: number;
};

/** Reads an installed Next.js release from the example's dependencies. */
function installedRelease(packageName: string): NextRelease {
  const { version } = JSON.parse(
    readFileSync(path.join(dependencies, packageName, "package.json"), "utf8"),
  ) as { version: string };
  return { packageName, version, major: Number(version.split(".")[0]) };
}

/**
 * Next.js releases the example is verified against: the current release, the latest 15.x, and
 * the lowest supported 15.x. Keep them in sync with the `next` peer range of `content-query`.
 */
export const nextReleases: readonly NextRelease[] = ["next", "next-15.5", "next-15.0"].map(
  installedRelease,
);

/**
 * Returns the command-line flags that select a bundler. Next.js 16 builds and serves with
 * Turbopack by default and accepts both flags; Next.js 15 uses Webpack by default and only
 * accepts `--turbopack`.
 * @param release Next.js release that runs the command.
 * @param bundler Bundler to select.
 * @returns Flags to pass after `next dev` or `next build`.
 */
export function bundlerArguments(release: NextRelease, bundler: Bundler): string[] {
  if (release.major >= 16 || bundler === "turbopack") {
    return [`--${bundler}`];
  }
  return [];
}

/**
 * Links the example's dependencies into a fixture, resolving `next` to the selected release.
 * Each link targets the package's real directory, because Turbopack 15 does not follow a link
 * to another link, and every target stays inside the repository, which Turbopack requires.
 */
async function linkDependencies(release: NextRelease, destination: string): Promise<void> {
  await mkdir(destination);
  for (const entry of await readdir(dependencies)) {
    if (entry === ".bin" || nextReleases.some(({ packageName }) => packageName === entry)) {
      continue;
    }
    if (entry.startsWith("@")) {
      await mkdir(path.join(destination, entry));
      for (const scoped of await readdir(path.join(dependencies, entry))) {
        await symlink(
          await realpath(path.join(dependencies, entry, scoped)),
          path.join(destination, entry, scoped),
          "dir",
        );
      }
      continue;
    }
    await symlink(
      await realpath(path.join(dependencies, entry)),
      path.join(destination, entry),
      "dir",
    );
  }
  await symlink(
    await realpath(path.join(dependencies, release.packageName)),
    path.join(destination, "next"),
    "dir",
  );
}

/** An isolated copy of the example application. */
export type Fixture = {
  /** Application directory. */
  root: string;
  /** Temporary directory to remove after the test. */
  workspace: string;
  /** Path to the selected release's `next` command-line script. */
  next: string;
};

/**
 * Copies the example into a temporary directory inside the repository, so both bundlers can
 * resolve its workspace packages, and links the selected Next.js release as `next`.
 * @param release Next.js release to install into the fixture.
 * @returns The fixture's directories and `next` script.
 */
export async function createFixture(release: NextRelease): Promise<Fixture> {
  const temporaryRoot = path.join(repositoryRoot, ".content-query");
  await mkdir(temporaryRoot, { recursive: true });
  const workspace = await realpath(await mkdtemp(path.join(temporaryRoot, "next-test-")));
  const root = path.join(workspace, "app");
  await mkdir(root);
  for (const source of [
    "app",
    "content",
    "content-query.config.ts",
    "next.config.mjs",
    "package.json",
    "tsconfig.json",
  ]) {
    await cp(path.join(appRoot, source), path.join(root, source), { recursive: true });
  }
  await linkDependencies(release, path.join(root, "node_modules"));
  if (release.major < 16) {
    await declareStylesheets(root);
  }
  return { root, workspace, next: path.join(root, "node_modules/next/dist/bin/next") };
}

/**
 * Declares plain stylesheet imports, as Next.js 16's global types do. Next.js 15 type checks
 * builds, and the workspace's TypeScript 6 rejects undeclared side-effect imports by default.
 */
async function declareStylesheets(root: string): Promise<void> {
  const declarations = "stylesheets.d.ts";
  await writeFile(path.join(root, declarations), 'declare module "*.css";\n');
  const tsconfig = path.join(root, "tsconfig.json");
  const options = JSON.parse(await readFile(tsconfig, "utf8")) as { include: string[] };
  options.include.push(declarations);
  await writeFile(tsconfig, `${JSON.stringify(options, null, 2)}\n`);
}
