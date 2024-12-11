import React from "react";
import DynamicImage from "@/app/components/DynamicImage";

interface ContentEditorProps {
  contents: { type: string; content: string }[];
  setContents: (contents: { type: string; content: string }[]) => void;
}

const ContentEditor: React.FC<ContentEditorProps> = ({ contents, setContents }) => {
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
      // Replace this with your S3 upload API endpoint
      const res = await fetch("/api/s3upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const imageUrl = data.url; // Get the URL of the uploaded image
        console.log(imageUrl)
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

  return (
    <div>
      <h3 className="text-lg font-bold mb-4">Content Editor</h3>
      {contents.map((content, index) => (
        <div key={index} className="mb-4 p-4 border rounded-md bg-gray-50">
          {content.type === "text" ? (
            <textarea
              placeholder="Enter text"
              value={content.content}
              onChange={(e) => handleContentChange(index, e.target.value)}
              className="w-full p-2 border rounded-md"
            />
          ) : (
            <div>
              {!content.content ? (
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    e.target.files && handleUploadImage(index, e.target.files[0])
                  }
                  className="w-full p-2 border rounded-md"
                />
              ) : (
                <div className="flex flex-col items-start">
                  <DynamicImage
                    src={content.content}
                    alt="Uploaded"
                    maxWidth={300}
                    className="max-w-full max-h-40 mb-2"
                  />
                  <button
                    onClick={() => handleContentChange(index, "")}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove Image
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => handleRemoveContent(index)}
            className="mt-2 text-sm text-gray-600 hover:text-gray-900"
          >
            Remove Content
          </button>
        </div>
      ))}
      <div className="flex space-x-4">
        <button
          onClick={() => handleAddContent("text")}
          className="py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          + Add Text
        </button>
        <button
          onClick={() => handleAddContent("image")}
          className="py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700"
        >
          + Add Image
        </button>
      </div>
    </div>
  );
};

export default ContentEditor;