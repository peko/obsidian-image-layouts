import { type MarkdownPostProcessorContext, MarkdownView } from "obsidian";
import type ImageLayoutsPlugin from "../main";
import { replaceFenceLayout } from "./blocks";

const OPENING_FENCE = /^\s*(?:`{3,}|~{3,})\s*image-layout/;
const CLOSING_FENCE = /^\s*(?:`{3,}|~{3,})\s*$/;

// The editor of the note the block was rendered into. Looked up by the
// leaf whose DOM contains the block rather than by the active leaf: while
// dragging from the file explorer (or clicking a sidebar) the active leaf is
// the sidebar, not the note. Hover popovers and embeds render blocks from
// other files inside a different note, and writing there would corrupt it —
// hence the sourcePath check.
function editorForBlock(
  plugin: ImageLayoutsPlugin,
  ctx: MarkdownPostProcessorContext,
  parent: HTMLElement,
) {
  const { workspace } = plugin.app;
  let view: MarkdownView | null = null;
  workspace.iterateAllLeaves((leaf) => {
    if (
      !view &&
      leaf.view instanceof MarkdownView &&
      leaf.view.containerEl.contains(parent)
    ) {
      view = leaf.view;
    }
  });
  const found: MarkdownView | null =
    view ?? workspace.getActiveViewOfType(MarkdownView);
  if (!found || found.file?.path !== ctx.sourcePath) {
    return null;
  }
  return found.editor;
}

// Replaces the content between the fences of the codeblock rendered into
// `parent` with new source text. Returns false when the block's position
// can't be resolved or doesn't look like a fenced image-layout block (e.g.
// an unclosed block at the end of a note, where lineEnd is content, not a
// fence — writing there would mangle the note).
export function writeBlockSource(
  plugin: ImageLayoutsPlugin,
  ctx: MarkdownPostProcessorContext,
  parent: HTMLElement,
  source: string,
): boolean {
  const editor = editorForBlock(plugin, ctx, parent);
  const info = ctx.getSectionInfo(parent);
  if (!editor || !info) {
    return false;
  }
  if (
    !OPENING_FENCE.test(editor.getLine(info.lineStart)) ||
    !CLOSING_FENCE.test(editor.getLine(info.lineEnd))
  ) {
    return false;
  }
  const text = source === "" || source.endsWith("\n") ? source : `${source}\n`;
  editor.replaceRange(
    text,
    { line: info.lineStart + 1, ch: 0 },
    { line: info.lineEnd, ch: 0 },
  );
  return true;
}

// Renames the layout token on a legacy block's opening fence line, e.g.
// ```image-layout-a → ```image-layout-masonry-3.
export function renameFenceLayout(
  plugin: ImageLayoutsPlugin,
  ctx: MarkdownPostProcessorContext,
  parent: HTMLElement,
  layout: string,
): boolean {
  const editor = editorForBlock(plugin, ctx, parent);
  const info = ctx.getSectionInfo(parent);
  if (!editor || !info) {
    return false;
  }
  const fenceLine = editor.getLine(info.lineStart);
  const renamed = replaceFenceLayout(fenceLine, layout);
  if (renamed === null) {
    return false;
  }
  editor.replaceRange(
    renamed,
    { line: info.lineStart, ch: 0 },
    { line: info.lineStart, ch: fenceLine.length },
  );
  return true;
}

// Whether writeBlockSource would be able to edit the block rendered into
// `parent` right now. Lets callers bail out before doing side effects (like
// copying dropped files into the vault) that would be wasted otherwise.
export function canWriteBlockSource(
  plugin: ImageLayoutsPlugin,
  ctx: MarkdownPostProcessorContext,
  parent: HTMLElement,
): boolean {
  const editor = editorForBlock(plugin, ctx, parent);
  const info = ctx.getSectionInfo(parent);
  return (
    !!editor &&
    !!info &&
    OPENING_FENCE.test(editor.getLine(info.lineStart)) &&
    CLOSING_FENCE.test(editor.getLine(info.lineEnd))
  );
}
