import * as React from "react";
const { useRef, useState, useCallback } = React;
import { Notice } from "obsidian";

import type { AttachedFile } from "../types/chat";
import { getLogger } from "../utils/logger";

// ============================================================================
// Image Constants
// ============================================================================

/** Maximum image size in MB */
const MAX_IMAGE_SIZE_MB = 5;

/** Maximum image size in bytes */
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

/** Maximum number of attachments per message (images + files combined) */
const MAX_ATTACHMENT_COUNT = 10;

/** Supported image MIME types (whitelist) */
const SUPPORTED_IMAGE_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
] as const;

type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

// ============================================================================
// Attachments Hook
// ============================================================================

export interface UseAttachmentsOptions {
	/** Currently attached files (state owned by the parent — broadcast commands depend on it) */
	attachedFiles: AttachedFile[];
	/** Callback when attached files change */
	onAttachedFilesChange: (files: AttachedFile[]) => void;
	/** Whether the agent supports image attachments */
	supportsImages: boolean;
}

export interface UseAttachmentsReturn {
	/** Whether a file drag is currently over the drop zone */
	isDraggingOver: boolean;
	/** Paste handler for the textarea (file/image attachment) */
	handlePaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
	/** Drag & drop handlers for the drop-zone element */
	dragHandlers: {
		onDragOver: React.DragEventHandler<HTMLElement>;
		onDragEnter: React.DragEventHandler<HTMLElement>;
		onDragLeave: React.DragEventHandler<HTMLElement>;
		onDrop: React.DragEventHandler<HTMLElement>;
	};
}

/**
 * Hook for file/image attachment handling (paste + drag & drop).
 *
 * Attachment state stays in the parent (controlled) so broadcast commands
 * that read/write the input state keep working.
 */
export function useAttachments({
	attachedFiles,
	onAttachedFilesChange,
	supportsImages,
}: UseAttachmentsOptions): UseAttachmentsReturn {
	const [isDraggingOver, setIsDraggingOver] = useState(false);
	const dragCounterRef = useRef(0);

	/**
	 * Add multiple attachments at once with limit enforcement.
	 * Single state update avoids stale closure issues.
	 */
	const addAttachments = useCallback(
		(newFiles: AttachedFile[]) => {
			if (newFiles.length === 0) return;
			const remaining = MAX_ATTACHMENT_COUNT - attachedFiles.length;
			if (remaining <= 0) {
				new Notice(
					`[Agent Client] Maximum ${MAX_ATTACHMENT_COUNT} attachments allowed`,
				);
				return;
			}
			const toAdd = newFiles.slice(0, remaining);
			if (toAdd.length < newFiles.length) {
				new Notice(
					`[Agent Client] Maximum ${MAX_ATTACHMENT_COUNT} attachments allowed`,
				);
			}
			onAttachedFilesChange([...attachedFiles, ...toAdd]);
		},
		[attachedFiles, onAttachedFilesChange],
	);

	/**
	 * Convert a File to Base64 string.
	 */
	const fileToBase64 = useCallback(async (file: File): Promise<string> => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				const result = reader.result as string;
				// Extract base64 part from "data:image/png;base64,..."
				const base64 = result.split(",")[1];
				resolve(base64);
			};
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}, []);

	/**
	 * Convert image files to Base64 AttachedFile objects.
	 * Returns the converted attachments without updating state.
	 */
	const convertImagesToAttachments = useCallback(
		async (files: File[]): Promise<AttachedFile[]> => {
			const result: AttachedFile[] = [];
			for (const file of files) {
				if (file.size > MAX_IMAGE_SIZE_BYTES) {
					new Notice(
						`[Agent Client] Image too large (max ${MAX_IMAGE_SIZE_MB}MB)`,
					);
					continue;
				}
				try {
					const base64 = await fileToBase64(file);
					result.push({
						id: crypto.randomUUID(),
						kind: "image",
						data: base64,
						mimeType: file.type,
					});
				} catch (error) {
					getLogger().error("Failed to convert image:", error);
					new Notice("[Agent Client] Failed to attach image");
				}
			}
			return result;
		},
		[fileToBase64],
	);

	/**
	 * Convert files to resource_link AttachedFile objects.
	 * Returns the converted attachments without updating state.
	 */
	const convertFilesToAttachments = useCallback(
		(files: File[]): AttachedFile[] => {
			// Get file path via Electron's webUtils API (File.path was removed in Electron 32)
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron is a runtime-only module provided by Obsidian's host environment
			const { webUtils } = require("electron") as {
				webUtils: { getPathForFile: (file: File) => string };
			};
			const result: AttachedFile[] = [];
			for (const file of files) {
				const filePath = webUtils.getPathForFile(file);
				if (!filePath) {
					new Notice("[Agent Client] Could not determine file path");
					continue;
				}
				result.push({
					id: crypto.randomUUID(),
					kind: "file",
					mimeType: file.type || "application/octet-stream",
					name: file.name,
					path: filePath,
					size: file.size,
				});
			}
			return result;
		},
		[],
	);

	/**
	 * Handle paste event for file attachment.
	 * Images are embedded as Base64 if agent supports it, otherwise sent as resource_link.
	 * Non-image files are sent as resource_link.
	 */
	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			const items = e.clipboardData?.items;
			if (!items) return;

			// Extract files from clipboard, split by type
			const imageFiles: File[] = [];
			const nonImageFiles: File[] = [];

			for (const item of Array.from(items)) {
				if (item.kind !== "file") continue;
				const file = item.getAsFile();
				if (!file) continue;

				if (
					SUPPORTED_IMAGE_TYPES.includes(
						item.type as SupportedImageType,
					)
				) {
					imageFiles.push(file);
				} else {
					nonImageFiles.push(file);
				}
			}

			if (imageFiles.length === 0 && nonImageFiles.length === 0) return;

			e.preventDefault();

			const newAttachments: AttachedFile[] = [];

			if (imageFiles.length > 0) {
				if (supportsImages) {
					newAttachments.push(
						...(await convertImagesToAttachments(imageFiles)),
					);
				} else {
					// Try resource_link fallback (works for files copied from Finder, not for screenshots)
					const converted = convertFilesToAttachments(imageFiles);
					if (converted.length > 0) {
						newAttachments.push(...converted);
					} else {
						new Notice(
							"[Agent Client] This agent does not support image paste. Try drag & drop instead.",
						);
					}
				}
			}

			if (nonImageFiles.length > 0) {
				newAttachments.push(
					...convertFilesToAttachments(nonImageFiles),
				);
			}

			addAttachments(newAttachments);
		},
		[
			supportsImages,
			convertImagesToAttachments,
			convertFilesToAttachments,
			addAttachments,
		],
	);

	/**
	 * Handle drag over event to allow drop.
	 */
	const handleDragOver = useCallback((e: React.DragEvent) => {
		if (e.dataTransfer?.types.includes("Files")) {
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		}
	}, []);

	/**
	 * Handle drag enter event for visual feedback.
	 * Uses counter to handle child element enter/leave correctly.
	 */
	const handleDragEnter = useCallback((e: React.DragEvent) => {
		if (e.dataTransfer?.types.includes("Files")) {
			e.preventDefault();
			dragCounterRef.current++;
			if (dragCounterRef.current === 1) {
				setIsDraggingOver(true);
			}
		}
	}, []);

	/**
	 * Handle drag leave event to reset visual feedback.
	 */
	const handleDragLeave = useCallback((_e: React.DragEvent) => {
		dragCounterRef.current--;
		if (dragCounterRef.current === 0) {
			setIsDraggingOver(false);
		}
	}, []);

	/**
	 * Handle drop event for file attachments.
	 * Images are embedded as Base64 if agent supports it, otherwise sent as resource_link.
	 * Non-image files are always sent as resource_link.
	 */
	const handleDrop = useCallback(
		async (e: React.DragEvent) => {
			dragCounterRef.current = 0;
			setIsDraggingOver(false);

			const files = e.dataTransfer?.files;
			if (!files || files.length === 0) return;

			e.preventDefault();

			const droppedFiles = Array.from(files);
			const imageFiles: File[] = [];
			const nonImageFiles: File[] = [];

			for (const file of droppedFiles) {
				if (
					SUPPORTED_IMAGE_TYPES.includes(
						file.type as SupportedImageType,
					)
				) {
					imageFiles.push(file);
				} else if (file.type || file.name) {
					nonImageFiles.push(file);
				}
			}

			// Convert all files, then update state once
			const newAttachments: AttachedFile[] = [];

			if (imageFiles.length > 0) {
				if (supportsImages) {
					newAttachments.push(
						...(await convertImagesToAttachments(imageFiles)),
					);
				} else {
					newAttachments.push(
						...convertFilesToAttachments(imageFiles),
					);
				}
			}

			if (nonImageFiles.length > 0) {
				newAttachments.push(
					...convertFilesToAttachments(nonImageFiles),
				);
			}

			addAttachments(newAttachments);
		},
		[
			supportsImages,
			convertImagesToAttachments,
			convertFilesToAttachments,
			addAttachments,
		],
	);

	return {
		isDraggingOver,
		// Discard the promises at the boundary, exactly like the original
		// inline JSX wrappers (`(e) => void handlePaste(e)`).
		handlePaste: (e) => void handlePaste(e),
		dragHandlers: {
			onDragOver: handleDragOver,
			onDragEnter: handleDragEnter,
			onDragLeave: handleDragLeave,
			onDrop: (e) => void handleDrop(e),
		},
	};
}
