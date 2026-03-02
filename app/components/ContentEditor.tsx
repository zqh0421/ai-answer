import React, { useState } from "react";
import { 
  Plus, 
  Type, 
  Image as ImageIcon, 
  Trash2, 
  Upload, 
  X,
  FileText,
  Image as ImageIcon2
} from "lucide-react";
import DynamicImage from "@/app/components/DynamicImage";

type LegacyContent = { type: string; content: string };
type SemanticBlock = {
  block_type: "text" | "image" | "instruction" | "latex" | "html";
  text_content?: string;
  media_url?: string;
  alt_text?: string;
};

interface ContentEditorProps {
  contents: { type: string; content: string }[];
  setContents: (contents: { type: string; content: string }[]) => void;
  mode?: "legacy" | "semantic";
  semanticBlocks?: SemanticBlock[];
  setSemanticBlocks?: (blocks: SemanticBlock[]) => void;
}

const ContentEditor: React.FC<ContentEditorProps> = ({
  contents,
  setContents,
  mode = "legacy",
  semanticBlocks,
  setSemanticBlocks,
}) => {
  const [dragOver, setDragOver] = useState<number | null>(null);
  const isSemantic = mode === "semantic" && Array.isArray(semanticBlocks) && typeof setSemanticBlocks === "function";
  const blocks = semanticBlocks ?? [];

  const handleAddContent = (type: string) => {
    if (isSemantic) {
      const nextType = type as SemanticBlock["block_type"];
      setSemanticBlocks([
        ...blocks,
        nextType === "image"
          ? { block_type: "image", media_url: "", alt_text: "" }
          : { block_type: nextType, text_content: "" },
      ]);
      return;
    }
    setContents([...contents, { type, content: "" }]);
  };

  const handleContentChange = (index: number, value: string) => {
    if (isSemantic) {
      const updated = [...blocks];
      const block = updated[index];
      if (!block) return;
      if ((block.block_type || "").toLowerCase() === "image") {
        updated[index] = { ...block, media_url: value };
      } else {
        updated[index] = { ...block, text_content: value };
      }
      setSemanticBlocks(updated);
      return;
    }
    const updatedContents = [...contents];
    updatedContents[index].content = value;
    setContents(updatedContents);
  };

  const handleSemanticBlockFieldChange = (index: number, field: keyof SemanticBlock, value: string) => {
    if (!isSemantic) return;
    const updated = [...blocks];
    if (!updated[index]) return;
    updated[index] = { ...updated[index], [field]: value };
    setSemanticBlocks(updated);
  };

  const moveContent = (index: number, direction: -1 | 1) => {
    if (isSemantic) {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= blocks.length) return;
      const updated = [...blocks];
      [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
      setSemanticBlocks(updated);
      return;
    }
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= contents.length) return;
    const updated = [...contents];
    [updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]];
    setContents(updated);
  };

  const handleUploadImage = async (index: number, file: File) => {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/s3upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const imageUrl = data.url;
        handleContentChange(index, imageUrl);
      } else {
        let errorDetail = "";
        try {
          const contentType = res.headers.get("content-type") || "";
          if (contentType.includes("application/json")) {
            const errorData = await res.json();
            errorDetail =
              typeof errorData?.detail === "string"
                ? errorData.detail
                : JSON.stringify(errorData?.detail ?? errorData);
          } else {
            errorDetail = await res.text();
          }
        } catch (parseError) {
          console.error("Failed to parse upload error response:", parseError);
        }
        console.error(`Image upload failed (${res.status})`, errorDetail || res.statusText);
      }
    } catch (error) {
      console.error("Error uploading image:", error);
    }
  };

  const handleRemoveContent = (index: number) => {
    if (isSemantic) {
      setSemanticBlocks(blocks.filter((_, i) => i !== index));
      return;
    }
    const updatedContents = contents.filter((_, i) => i !== index);
    setContents(updatedContents);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOver(index);
  };

  const handleDragLeave = () => {
    setDragOver(null);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOver(null);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        handleUploadImage(index, file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleUploadImage(index, files[0]);
    }
  };

  return (
    <div className="space-y-4">
      {(isSemantic ? blocks : contents).map((content: any, index) => (
        <div
          key={index}
          className={`relative group transition-all duration-300 ${
            dragOver === index ? 'ring-2 ring-blue-500 ring-opacity-50' : ''
          }`}
        >
          <div className={`bg-white rounded-xl border border-slate-200 transition-all duration-300 hover:border-slate-300 ${
            isSemantic ? "p-3 hover:shadow-sm" : "p-4 hover:shadow-md"
          }`}>
            {/* Content Type Indicator */}
            <div className={`flex items-center gap-2 ${isSemantic ? "mb-2" : "mb-3"}`}>
              <div className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300 ${
                (isSemantic ? String(content.block_type ?? "text") === "text" : content.type === 'text')
                  ? 'bg-blue-100 text-blue-600' 
                  : 'bg-emerald-100 text-emerald-600'
              }`}>
                {(isSemantic ? String(content.block_type ?? "text") === "text" : content.type === 'text') ? (
                  <Type className="w-3 h-3" />
                ) : (
                  <ImageIcon2 className="w-3 h-3" />
                )}
              </div>
              <span className="text-sm font-medium text-slate-600 capitalize">
                {isSemantic ? String(content.block_type ?? "text") : content.type} Content
              </span>
              {!isSemantic && content.type === "text" && (
                <span className="text-xs text-slate-500 ml-auto">
                  {content.content.length} characters
                </span>
              )}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveContent(index, -1)}
                  disabled={index === 0}
                  className={`rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 ${
                    isSemantic ? "px-1 py-0.5 text-xs" : "px-1"
                  }`}
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveContent(index, 1)}
                  disabled={index === (isSemantic ? blocks.length : contents.length) - 1}
                  className={`rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40 ${
                    isSemantic ? "px-1 py-0.5 text-xs" : "px-1"
                  }`}
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveContent(index)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all duration-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Content Input */}
            {(isSemantic ? String(content.block_type ?? "text") !== "image" : content.type === "text") ? (
              <div className="space-y-3">
                <textarea
                  placeholder={isSemantic ? "Enter block content..." : "Enter your question or content here..."}
                  value={isSemantic ? String(content.text_content ?? "") : content.content}
                  onChange={(e) => handleContentChange(index, e.target.value)}
                  className={`w-full border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 resize-none ${
                    isSemantic ? "px-3 py-2 min-h-[72px]" : "px-3 py-3 min-h-24"
                  }`}
                  rows={isSemantic ? 2 : 3}
                />
              </div>
            ) : (
              <div
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                className="space-y-3"
              >
                {!(isSemantic ? content.media_url : content.content) ? (
                  <div className="space-y-3">
                    <div className={`border-2 border-dashed border-slate-300 rounded-lg text-center hover:border-blue-400 transition-all duration-300 hover:bg-blue-50 ${
                      isSemantic ? "p-4" : "p-6"
                    }`}>
                      <Upload className={`${isSemantic ? "w-6 h-6 mb-2" : "w-8 h-8 mb-3"} text-slate-400 mx-auto`} />
                      <p className={`${isSemantic ? "text-xs" : "text-sm"} text-slate-600 mb-2`}>
                        Drop an image here or click to browse
                      </p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileSelect(e, index)}
                        className="hidden"
                        id={`image-upload-${index}`}
                      />
                      <label
                        htmlFor={`image-upload-${index}`}
                        className={`inline-flex items-center gap-2 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 rounded-lg hover:from-blue-100 hover:to-blue-200 transition-all duration-300 cursor-pointer ${
                          isSemantic ? "px-3 py-1.5 text-xs" : "px-4 py-2"
                        }`}
                      >
                        <ImageIcon className="w-4 h-4" />
                        Choose Image
                      </label>
                    </div>
                    {isSemantic ? (
                      <>
                        <input
                          type="text"
                          value={String(content.alt_text ?? "")}
                          onChange={(e) => handleSemanticBlockFieldChange(index, "alt_text", e.target.value)}
                          placeholder="Alt text (optional)"
                          className={`w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-900 outline-none focus:border-slate-300 ${
                            isSemantic ? "px-3 py-1.5" : "px-3 py-2"
                          }`}
                        />
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative group/image">
                      <DynamicImage
                        src={isSemantic ? String(content.media_url ?? "") : content.content}
                        alt={isSemantic ? String(content.alt_text ?? "Uploaded content") : "Uploaded content"}
                        className={`w-full object-cover rounded-lg border border-slate-200 transition-all duration-300 ${
                          isSemantic ? "max-h-36" : "max-h-48"
                        }`}
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover/image:bg-opacity-20 transition-all duration-300 rounded-lg flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => handleContentChange(index, "")}
                          className="opacity-0 group-hover/image:opacity-100 bg-white p-2 rounded-full shadow-lg hover:bg-red-50 transition-all duration-300"
                        >
                          <X className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Image content</span>
                      <button
                        type="button"
                        onClick={() => handleContentChange(index, "")}
                        className="text-red-500 hover:text-red-700 transition-all duration-300"
                      >
                        Remove image
                      </button>
                    </div>
                    {isSemantic ? (
                      <input
                        type="text"
                        value={String(content.alt_text ?? "")}
                        onChange={(e) => handleSemanticBlockFieldChange(index, "alt_text", e.target.value)}
                        placeholder="Alt text (optional)"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-300"
                      />
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Add Content Buttons */}
      <div className={`flex gap-2 ${isSemantic ? "pt-1" : ""}`}>
        <button
          type="button"
          onClick={() => handleAddContent("text")}
          className={`flex items-center gap-1.5 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 rounded-md hover:from-blue-100 hover:to-blue-200 transition-all duration-300 border border-blue-200 ${
            isSemantic ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
          }`}
        >
          <Plus className="w-3 h-3" />
          <FileText className="w-3 h-3" />
          Add Text
        </button>
        <button
          type="button"
          onClick={() => handleAddContent("image")}
          className={`flex items-center gap-1.5 bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-600 rounded-md hover:from-emerald-100 hover:to-emerald-200 transition-all duration-300 border border-emerald-200 ${
            isSemantic ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
          }`}
        >
          <Plus className="w-3 h-3" />
          <ImageIcon className="w-3 h-3" />
          Add Image
        </button>
      </div>

      {/* Empty State */}
      {(isSemantic ? blocks.length === 0 : contents.length === 0) && (
        <div className="text-center py-8">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-500 mb-4">No content added yet</p>
          <p className="text-sm text-slate-400">
            {isSemantic ? "Add content blocks to create your question" : "Add text or images to create your question"}
          </p>
        </div>
      )}
    </div>
  );
};

export default ContentEditor;
