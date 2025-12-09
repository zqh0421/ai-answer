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

interface ContentEditorProps {
  contents: { type: string; content: string }[];
  setContents: (contents: { type: string; content: string }[]) => void;
}

const ContentEditor: React.FC<ContentEditorProps> = ({ contents, setContents }) => {
  const [dragOver, setDragOver] = useState<number | null>(null);

  const handleAddContent = (type: string) => {
    setContents([...contents, { type, content: "" }]);
  };

  const handleContentChange = (index: number, value: string) => {
    const updatedContents = [...contents];
    updatedContents[index].content = value;
    setContents(updatedContents);
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
        console.error("Image upload failed");
      }
    } catch (error) {
      console.error("Error uploading image:", error);
    }
  };

  const handleRemoveContent = (index: number) => {
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
      {contents.map((content, index) => (
        <div
          key={index}
          className={`relative group transition-all duration-300 ${
            dragOver === index ? 'ring-2 ring-blue-500 ring-opacity-50' : ''
          }`}
        >
          <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all duration-300 hover:border-slate-300">
            {/* Content Type Indicator */}
            <div className="flex items-center gap-2 mb-3">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full transition-all duration-300 ${
                content.type === 'text' 
                  ? 'bg-blue-100 text-blue-600' 
                  : 'bg-emerald-100 text-emerald-600'
              }`}>
                {content.type === 'text' ? (
                  <Type className="w-3 h-3" />
                ) : (
                  <ImageIcon2 className="w-3 h-3" />
                )}
              </div>
              <span className="text-sm font-medium text-slate-600 capitalize">
                {content.type} Content
              </span>
              {content.type === "text" && (
                <span className="text-xs text-slate-500 ml-auto">
                  {content.content.length} characters
                </span>
              )}
              <button
                onClick={() => handleRemoveContent(index)}
                className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-all duration-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Content Input */}
            {content.type === "text" ? (
              <div className="space-y-3">
                <textarea
                  placeholder="Enter your question or content here..."
                  value={content.content}
                  onChange={(e) => handleContentChange(index, e.target.value)}
                  className="w-full px-3 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 resize-none min-h-24"
                  rows={3}
                />
              </div>
            ) : (
              <div
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                className="space-y-3"
              >
                {!content.content ? (
                  <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-400 transition-all duration-300 hover:bg-blue-50">
                    <Upload className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                    <p className="text-sm text-slate-600 mb-2">
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
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 rounded-lg hover:from-blue-100 hover:to-blue-200 transition-all duration-300 cursor-pointer"
                    >
                      <ImageIcon className="w-4 h-4" />
                      Choose Image
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative group/image">
                      <DynamicImage
                        src={content.content}
                        alt="Uploaded content"
                        className="w-full max-h-48 object-cover rounded-lg border border-slate-200 transition-all duration-300"
                      />
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover/image:bg-opacity-20 transition-all duration-300 rounded-lg flex items-center justify-center">
                        <button
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
                        onClick={() => handleContentChange(index, "")}
                        className="text-red-500 hover:text-red-700 transition-all duration-300"
                      >
                        Remove image
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Add Content Buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => handleAddContent("text")}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-600 rounded-md hover:from-blue-100 hover:to-blue-200 transition-all duration-300 border border-blue-200 text-sm"
        >
          <Plus className="w-3 h-3" />
          <FileText className="w-3 h-3" />
          Add Text
        </button>
        <button
          onClick={() => handleAddContent("image")}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-600 rounded-md hover:from-emerald-100 hover:to-emerald-200 transition-all duration-300 border border-emerald-200 text-sm"
        >
          <Plus className="w-3 h-3" />
          <ImageIcon className="w-3 h-3" />
          Add Image
        </button>
      </div>

      {/* Empty State */}
      {contents.length === 0 && (
        <div className="text-center py-8">
          <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <p className="text-slate-500 mb-4">No content added yet</p>
          <p className="text-sm text-slate-400">Add text or images to create your question</p>
        </div>
      )}
    </div>
  );
};

export default ContentEditor;