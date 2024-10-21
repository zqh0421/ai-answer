'use client'
import axios from "axios";
import { useState, useEffect } from "react";
import Link from "next/link";

interface Course {
  course_id: string;
  course_title: string;
  course_description?: string;
  created_at?: string;
}

const CourseOverview = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [newCourseTitle, setNewCourseTitle] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false); // State for modal visibility
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null); // State to track deletion status

  // Fetch existing courses
  const fetchCourses = async () => {
    try {
      const createrId = "1"
      const res = await axios.get(`/api/courses/createdby/${createrId}`);
      setCourses(res.data);
    } catch (err) {
      console.error("Error fetching courses:", err);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  // Handle course creation
  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setLoading(true);
    const createrId = "1";
    try {
      const res = await axios.post(`/api/courses/create`, {
        title: newCourseTitle,
        description: newCourseDescription,
        creater_id: createrId
      });

      if (res.status === 200 || res.status === 201) {
        fetchCourses();
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error creating course:", error);
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  // Handle course deletion
  const handleDeleteCourse = async (courseId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this course?");
    if (!confirmDelete) return;

    setDeleting(courseId);
    try {
      const res = await axios.delete(`/api/courses/${courseId}`);
      if (res.status === 200 || res.status === 204) {
        fetchCourses(); // Refresh course list after deletion
      }
    } catch (error) {
      console.error("Error deleting course:", error);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <main className="p-6">
      <h1 className="text-3xl font-bold mb-6">Course Overview</h1>

      {/* Modal Trigger Button */}
      <section className="bg-white p-6 rounded-lg shadow-lg mb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Your Courses</h2>
          <button
            onClick={() => setIsModalOpen(true)}  // Open modal on click
            className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Create Course
          </button>
        </div>
        <ul className="space-y-4 mt-4">
          {courses.length === 0 ? (
            <li className="text-gray-500">No courses available</li>
          ) : (
            courses.map((course) => (
              <li key={course.course_id} className="flex items-center justify-between bg-gray-100 p-4 rounded-lg shadow-sm">
                <div className="flex items-center">
                  <Link href={`/manage/course/${course.course_id}`}>
                    <span className="text-lg font-medium text-indigo-600 hover:text-indigo-800">
                      {course.course_title}
                    </span>
                  </Link>
                </div>
                <div className="flex items-center space-x-4">
                  <button
                    onClick={() => handleDeleteCourse(course.course_id)}
                    className={`inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 ${
                      deleting === course.course_id ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                    disabled={deleting === course.course_id}  // Disable the button while deleting
                  >
                    {deleting === course.course_id ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75">
          <div className="bg-white rounded-lg p-8 shadow-lg w-full max-w-md">
            <h2 className="text-2xl font-semibold mb-4">Create New Course</h2>
            <form onSubmit={handleCreateCourse}>
              <div className="mb-4">
                <label htmlFor="courseTitle" className="block text-sm font-medium text-gray-700">
                  Course Title
                </label>
                <input
                  id="courseTitle"
                  type="text"
                  value={newCourseTitle}
                  onChange={(e) => setNewCourseTitle(e.target.value)}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>
              <div className="mb-4">
                <label htmlFor="courseDescription" className="block text-sm font-medium text-gray-700">
                  Course Description
                </label>
                <textarea
                  id="courseDescription"
                  value={newCourseDescription}
                  onChange={(e) => setNewCourseDescription(e.target.value)}
                  className="mt-1 block w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div className="flex justify-end space-x-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)} // Close modal on cancel
                  className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                  {loading ? "Creating..." : "Create Course"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default CourseOverview;