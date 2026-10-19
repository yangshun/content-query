export type ContentHeading = { depth: number; slug: string; text: string };
export type ContentRenderResult = { html: string; headings: ContentHeading[] };
export type RenderedContent = {
  html: string;
  metadata?: { headings?: ContentHeading[]; imagePaths?: string[]; [key: string]: unknown };
};
