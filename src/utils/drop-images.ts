import { type MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import type ImageLayoutsPlugin from "../main";
import { appendImageLines } from "./blocks";
import { canWriteBlockSource, writeBlockSource } from "./editor-writeback";
import { IMAGE_EXTENSIONS } from "./folder-images";

const DRAG_OVER_CLASS = "image-layouts-drag-over";

// Obsidian's internal drag state (file explorer, search results, tab
// headers). Not part of the public API, so every field is treated as
// optional and checked before use.
type Draggable = {
  type?: string;
  file?: unknown;
  files?: unknown[];
};

const getDraggable = (plugin: ImageLayoutsPlugin): Draggable | null => {
  const app = plugin.app as unknown as {
    dragManager?: { draggable?: Draggable | null };
  };
  return app.dragManager?.draggable ?? null;
};

const isImageFile = (file: unknown): file is TFile =>
  file instanceof TFile && IMAGE_EXTENSIONS.has(file.extension.toLowerCase());

const extensionOf = (name: string): string =>
  name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";

const isImageUpload = (file: File): boolean =>
  file.type.startsWith("image/") ||
  IMAGE_EXTENSIONS.has(extensionOf(file.name));

const vaultImagesFromDraggable = (draggable: Draggable | null): TFile[] => {
  if (!draggable) {
    return [];
  }
  if (draggable.type === "file") {
    return isImageFile(draggable.file) ? [draggable.file] : [];
  }
  if (draggable.type === "files" && Array.isArray(draggable.files)) {
    return draggable.files.filter(isImageFile);
  }
  return [];
};

const urlsFromTransfer = (transfer: DataTransfer): string[] => {
  const raw =
    transfer.getData("text/uri-list") || transfer.getData("text/plain") || "";
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .filter((line) => /^https?:\/\//i.test(line));
};

const embedLink = (
  plugin: ImageLayoutsPlugin,
  file: TFile,
  sourcePath: string,
): string =>
  `!${plugin.app.fileManager.generateMarkdownLink(file, sourcePath)}`;

// Copies dropped OS files into the vault using the user's attachment
// settings (folder, naming) — the same place Obsidian itself would put them.
const saveUploads = async (
  plugin: ImageLayoutsPlugin,
  uploads: File[],
  sourcePath: string,
): Promise<TFile[]> => {
  const saved: TFile[] = [];
  for (const upload of uploads) {
    try {
      const name =
        upload.name || `Dropped image.${upload.type.split("/")[1] || "png"}`;
      const path = await plugin.app.fileManager.getAvailablePathForAttachment(
        name,
        sourcePath,
      );
      saved.push(
        await plugin.app.vault.createBinary(path, await upload.arrayBuffer()),
      );
    } catch (error) {
      console.error("Image Layouts: failed to save dropped file", error);
      new Notice(`Image Layouts: couldn't save ${upload.name}.`);
    }
  }
  return saved;
};

const transferLooksDroppable = (
  plugin: ImageLayoutsPlugin,
  transfer: DataTransfer | null,
): boolean => {
  if (vaultImagesFromDraggable(getDraggable(plugin)).length > 0) {
    return true;
  }
  if (!transfer) {
    return false;
  }
  // File contents and URLs aren't readable until drop, only their types.
  const types = Array.from(transfer.types);
  return types.includes("Files") || types.includes("text/uri-list");
};

// Lets images be dragged onto a rendered layout block: vault files from the
// file explorer, files from the OS file manager (copied in as attachments)
// and image URLs from a browser. Links are appended to the end of the block.
export function attachImageDropHandler(
  plugin: ImageLayoutsPlugin,
  ctx: MarkdownPostProcessorContext,
  parent: HTMLElement,
  source: string,
) {
  const accepts = (event: DragEvent) =>
    transferLooksDroppable(plugin, event.dataTransfer) &&
    canWriteBlockSource(plugin, ctx, parent);

  const onDragOver = (event: DragEvent) => {
    if (!accepts(event)) {
      return;
    }
    // Claim the drag so the editor underneath doesn't insert the links at
    // the drop cursor (which would land outside or mid-way through the block).
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = getDraggable(plugin) ? "link" : "copy";
    }
    parent.addClass(DRAG_OVER_CLASS);
  };

  const onDragLeave = (event: DragEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && parent.contains(next)) {
      return;
    }
    parent.removeClass(DRAG_OVER_CLASS);
  };

  const onDrop = async (event: DragEvent) => {
    parent.removeClass(DRAG_OVER_CLASS);
    if (!accepts(event)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const transfer = event.dataTransfer;
    const sourcePath = ctx.sourcePath;
    const draggable = getDraggable(plugin);
    let lines: string[] = [];

    if (draggable) {
      lines = vaultImagesFromDraggable(draggable).map((file) =>
        embedLink(plugin, file, sourcePath),
      );
    } else if (transfer && transfer.files.length > 0) {
      const uploads = Array.from(transfer.files).filter(isImageUpload);
      const saved = await saveUploads(plugin, uploads, sourcePath);
      lines = saved.map((file) => embedLink(plugin, file, sourcePath));
    } else if (transfer) {
      lines = urlsFromTransfer(transfer).map((url) => `![](${url})`);
    }

    if (lines.length === 0) {
      new Notice("Image Layouts: nothing to add — drop image files or links.");
      return;
    }
    if (
      !writeBlockSource(plugin, ctx, parent, appendImageLines(source, lines))
    ) {
      new Notice(
        `Image Layouts: couldn't update the block. Add manually:\n${lines.join(
          "\n",
        )}`,
      );
    }
  };

  parent.addEventListener("dragover", onDragOver);
  parent.addEventListener("dragenter", onDragOver);
  parent.addEventListener("dragleave", onDragLeave);
  parent.addEventListener("drop", onDrop);
}
