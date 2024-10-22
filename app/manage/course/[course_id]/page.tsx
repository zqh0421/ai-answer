'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import { usePathname } from 'next/navigation';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';

interface Course {
  course_id: string;
  course_title: string;
  course_description?: string;
  created_at?: string;
}

interface Module {
  module_id: string;
  module_title: string;
}

interface Slide {
  slide_google_id: string
  slide_title: string
  slide_url: string
  slide_cover: string
}

const CoursePage = () => {
  const pathname = usePathname();
  const pathnames = pathname.split('/');
  const courseId = pathnames[pathnames.length - 1];
  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [slidesByModule, setSlidesByModule] = useState<Record<string, Slide[]>>({});
  const [loading, setLoading] = useState(true);

  // States for creating module and uploading slide
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false); // Modal state for creating module
  const [selectedModuleForSlide, setSelectedModuleForSlide] = useState<string | null>(null);
  const [driveFolderLink, setDriveFolderLink] = useState(''); // Input field for Drive folder link
  const [isSlideModalOpen, setIsSlideModalOpen] = useState(false);
  const [slideInfoList, setSlideInfoList] = useState<Slide[]>([]); // Stores metadata of fetched slides
  const [showConfirmation, setShowConfirmation] = useState(false); // State to control the confirmation pop-up

  // Fetch the course details and modules when the component mounts
  useEffect(() => {
    if (courseId) {
      const fetchCourseData = async () => {
        try {
          // Fetch course details
          const courseRes = await axios.get(`/api/courses/by_id/${courseId}`);
          setCourse(courseRes.data);

          // Fetch course modules
          const modulesRes = await axios.get(`/api/courses/by_id/${courseId}/modules`);
          setModules(modulesRes.data.modules);

          setLoading(false);
        } catch (err) {
          console.error('Error fetching course or modules:', err);
          setLoading(false);
        }
      };
      fetchCourseData();
    }
  }, [courseId]);


  // Helper function to extract Google Drive folder ID from the link
  const extractFolderIdFromLink = (link: string): string | null => {
    const regex = /\/folders\/([a-zA-Z0-9_-]+)/; // 正确的正则表达式，不需要引号和转义斜杠
    const match = link.match(regex);
    return match ? match[1] : null;
  };  

  // Helper function to fetch files' metadata inside a Google Drive folder
  const fetchDriveFolderFiles = async (folderId: string): Promise<Slide[]> => {
    try {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY;
      const requestUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,mimeType,thumbnailLink)&key=${apiKey}`;
      const res = await axios.get(requestUrl);
  
      const slidesInfo: Slide[] = await Promise.all(
        res.data.files.map(async (file: any) => {
          if (file.mimeType === 'application/vnd.google-apps.presentation') {
            // If it's a Google Slides (PPT), export it as PDF
            const exportUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=application/pdf&key=${apiKey}`;
            return {
              slide_google_id: file.id,
              slide_title: file.name,
              slide_url: exportUrl,
              slide_cover: file.thumbnailLink,
            };
          } else if (file.mimeType === 'application/pdf') {
            // If it's already a PDF, no conversion needed
            return {
              slide_google_id: file.id,
              slide_title: file.name,
              slide_url: `https://drive.google.com/file/d/${file.id}/view`,
              slide_cover: file.thumbnailLink,
            };
          }
          return null; // Skip other file types
        })
      );
  
      return slidesInfo.filter((slide) => slide !== null); // Filter out any null entries
    } catch (error) {
      console.error('Error fetching or converting files:', error.response?.data || error.message);
      return [];
    }
  };

  // Function to delete a module
  const handleDeleteModule = async (moduleId: string) => {
    const confirmDelete = window.confirm('Are you sure you want to delete this module?');
    if (!confirmDelete) return;

    try {
      await axios.delete(`/api/modules/by_id/${moduleId}`);
      setModules((prevModules) => prevModules.filter(module => module.module_id !== moduleId));
      alert('Module deleted successfully');
    } catch (error) {
      console.error('Error deleting module:', error);
      alert('Failed to delete module');
    }
  };

  // Function to delete a slide
  const handleDeleteSlide = async (moduleId: string, slideId: string) => {
    const confirmDelete = window.confirm('Are you sure you want to delete this slide?');
    if (!confirmDelete) return;

    try {
      await axios.delete(`/api/modules/${moduleId}/slides/${slideId}`);
      setSlidesByModule((prevSlides) => ({
        ...prevSlides,
        [moduleId]: prevSlides[moduleId].filter(slide => slide.slide_google_id !== slideId),
      }));
      alert('Slide deleted successfully');
    } catch (error) {
      console.error('Error deleting slide:', error);
      alert('Failed to delete slide');
    }
  };

  // Fetch metadata for the files in the pasted Drive folder link
  const handleFetchSlidesFromFolder = async () => {
    console.log("fetch")
    const folderId = extractFolderIdFromLink(driveFolderLink);
    if (folderId) {
      console.log("YEs")
      const slidesInfo = await fetchDriveFolderFiles(folderId);
      setSlideInfoList(slidesInfo); // Store fetched slide metadata
      setShowConfirmation(true); // Trigger confirmation pop-up
    }
  };

  // Fetch slides for a specific module
  const fetchSlides = async (moduleId: string) => {
    console.log("fetching")
    try {
      const slidesRes = await axios.get(`/api/modules/${moduleId}/slides`);
      setSlidesByModule((prevSlides) => ({
        ...prevSlides,
        [moduleId]: slidesRes.data.slides, // Store slides by module ID
      }));
    } catch (err) {
      console.error('Error fetching slides:', err);
    }
  };

  // Submit fetched slides metadata to the backend
  const handleCreateSlides = async () => {
    if (!selectedModuleForSlide || slideInfoList.length === 0) return;
    console.log(slideInfoList[0])
    try {
      const res = await axios.post(`/api/modules/${selectedModuleForSlide}/slides/batch`, {
        slides: slideInfoList,
      });
  
      if (res.status === 201) {
        console.log("selected: " + selectedModuleForSlide)
        fetchSlides(selectedModuleForSlide);
        setIsSlideModalOpen(false);
        setShowConfirmation(false);
        alert('Slides uploaded successfully!');
      }
    } catch (error) {
      console.error('Error uploading slides:', error);
      alert('Failed to upload slides.');
    }
  };
  
  const handlePublishSlide = async (slideGoogleId: string, slideId: string) => {
    try {
      const publishRes = await axios.post(`/api/slides/${slideId}/${slideGoogleId}/publish`);
      console.log("FINISHED")
      if (publishRes.status === 200) {
        alert('Slide published successfully!');
      }
    } catch (error) {
      console.error('Error publishing slide:', error);
      alert('Failed to publish slide.');
    }
  };

  // Check if slides have been loaded for the module
  const handleModuleClick = (moduleId: string) => {
    if (!slidesByModule[moduleId]) {
      fetchSlides(moduleId); // Fetch slides only if not already fetched
    }
  };

  // Handle creating a new module
  const handleCreateModule = async () => {
    try {
      const res = await axios.post(`/api/courses/by_id/${courseId}/modules`, {
        title: newModuleTitle,
      });

      if (res.status === 201) {
        setModules([...modules, res.data]); // Add the new module to the list
        setNewModuleTitle(''); // Reset input field
        setIsModalOpen(false); // Close modal after creation
      }
    } catch (error) {
      console.error('Error creating module:', error);
    }
  };

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!course) {
    return <p>Course not found</p>;
  }

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold mb-4">Course - {course.course_title}</h1>
      <p className="text-lg mb-4">Description: {course.course_description ? course.course_description : 'N/A.'}</p>
      <p className="text-sm text-gray-500">Created at: {course.created_at}</p>
      <section className='mt-8'>
        <button
          onClick={async () => {
            await handlePublish()
          }}
          className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Publish Course
        </button>
      </section>
      {/* Module Management */}
      <section className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">Modules</h2>
          <button
            onClick={() => setIsModalOpen(true)}
            className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create New Module
          </button>
        </div>
        
        {modules.length === 0 ? (
          <p>No modules available.</p>
        ) : (
          <div className="space-y-4">
            {modules.map((module) => (
              <div key={module.module_id} className="bg-white shadow rounded p-4">
                <Disclosure>
                  <DisclosureButton
                    onClick={() => handleModuleClick(module.module_id)}
                    className="py-2 text-xl font-semibold"
                  >
                    {module.module_title}
                  </DisclosureButton>
                  <DisclosurePanel className="mt-4">
                    {slidesByModule[module.module_id]?.length === 0 ? (
                      <p>No slides available for this module.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-8">
                        {slidesByModule[module.module_id]?.map((slide) => (
                          <div key={slide.slide_google_id} className="bg-gray-100 rounded p-4 shadow overflow-hidden">
                            <h3> 
                              <a href={slide.slide_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 max-w-[90%] text-wrap">
                                {slide.slide_title}
                              </a>
                            </h3>
                            {slide.slide_cover && (
                              <img
                                src={slide.slide_cover}
                                alt={`${slide.slide_title} cover`}
                                className="w-64 mt-2 rounded"
                              />
                            )}
                            <button
                              onClick={() => handlePublishSlide(slide.slide_google_id, slide.id)}
                              className="mt-2 mr-4 p-2 bg-green-600 text-white rounded hover:bg-green-700"
                            >
                              Publish Slide
                            </button>
                            <button
                              onClick={() => handleDeleteSlide(module.module_id, slide.slide_google_id)}
                              className="mt-2 p-2 bg-red-600 text-white rounded hover:bg-red-700"
                            >
                              Delete Slide
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setSelectedModuleForSlide(module.module_id);
                        setIsSlideModalOpen(true);
                      }}
                      className="mt-2 p-2 bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Add Slides (Google Drive Folder)
                    </button>
                    <button
                      onClick={() => handleDeleteModule(module.module_id)}
                      className="mt-2 p-2 bg-red-600 text-white rounded hover:bg-red-700"
                    >
                      Delete Module
                    </button>
                  </DisclosurePanel>
                </Disclosure>
              </div>
            ))}
          </div>
        )}
      </section>

       {/* Modal for Google Drive Folder Link */}
       {isSlideModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96">
            <h2 className="text-2xl font-semibold mb-4">Add Slides from Google Drive Folder</h2>
            <input
              type="text"
              value={driveFolderLink}
              onChange={(e) => setDriveFolderLink(e.target.value)}
              placeholder="Paste Google Drive folder link"
              className="p-2 border rounded w-full mb-4"
            />
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setIsSlideModalOpen(false)}
                className="p-2 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleFetchSlidesFromFolder}
                className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Fetch Slides
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for creating a new module */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96">
            <h2 className="text-2xl font-semibold mb-4">Create New Module</h2>
            <input
              type="text"
              value={newModuleTitle}
              onChange={(e) => setNewModuleTitle(e.target.value)}
              placeholder="Module Title"
              className="p-2 border rounded w-full mb-4"
            />
            <div className="flex justify-end space-x-4">
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateModule}
                className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Pop-up */}
      {isSlideModalOpen && showConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50">
          {slideInfoList.length ? (<div className="bg-white p-6 rounded-lg shadow-lg w-[500px]">
            <h2 className="text-2xl font-semibold mb-4">Confirm Upload</h2>
            <p className="mb-4">The following {slideInfoList.length} files were fetched from the Google Drive folder. Do you want to upload them?</p>
            <ul className="space-y-2 max-h-40 overflow-y-scroll list-disc">
              {slideInfoList.map((slide) => (
                <li key={slide.slide_google_id}>
                  <p>{slide.slide_title}</p>
                </li>
              ))}
            </ul>
            <div className="flex justify-end space-x-4 mt-4">
              <button
                onClick={() => setShowConfirmation(false)}
                className="p-2 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSlides}
                className="p-2 bg-green-600 text-white rounded hover:bg-green-700"
              >
                Upload
              </button>
            </div>
          </div>) :
          (
            <div className="bg-white p-6 rounded-lg shadow-lg w-[500px]">
              <h2 className="text-2xl font-semibold mb-4">Confirm Upload</h2>
              <div className="flex justify-end space-x-4 mt-4">
              <button
                onClick={() => setShowConfirmation(false)}
                className="p-2 bg-gray-400 text-white rounded hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
};

export default CoursePage;
