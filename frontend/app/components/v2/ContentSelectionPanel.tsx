"use client";

import { useState, useEffect } from "react";
import { Course, Module, Slide } from "@/app/types";

interface ContentSelectionPanelProps {
  course: string | undefined;
  setCourse: (course: string) => void;
  module: string[];
  setModule: (module: string[]) => void;
  slide: string[];
  setSlide: (slide: string[]) => void;
  onContinue: () => void;
  isAnyLoading: boolean;
}

export default function ContentSelectionPanel({
  course,
  setCourse,
  module,
  setModule,
  slide,
  setSlide,
  onContinue,
  isAnyLoading,
}: ContentSelectionPanelProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [availableModules, setAvailableModules] = useState<Module[]>([]);
  const [availableSlides, setAvailableSlides] = useState<Slide[]>([]);

  // Fetch courses on mount
  useEffect(() => {
    fetch("/api/courses/public")
      .then((response) => response.json())
      .then((data) => {
        setCourses(data);
        if (data.length > 0 && !course) {
          setCourse(data[0].course_id);
        }
      })
      .catch((error) => {
        console.error("Error fetching courses:", error);
      });
  }, [course, setCourse]);

  // Fetch modules when course changes
  useEffect(() => {
    if (course) {
      fetch(`/api/courses/by_id/${course}/modules`)
        .then((response) => response.json())
        .then((data) => {
          setAvailableModules(data.modules);
          setModule(data.modules.map((mod: Module) => mod.module_id));
        })
        .catch((error) => {
          console.error("Error fetching modules:", error);
        });
    }
  }, [course, setModule]);

  // Fetch slides when modules change
  useEffect(() => {
    if (module.length) {
      const fetchSlides = async () => {
        try {
          const slideRequests = module.map((modId) =>
            fetch(`/api/modules/${modId}/slides`).then((res) => res.json())
          );
          const slideResponses = await Promise.all(slideRequests);
          const allSlides = slideResponses.flatMap((res) => res.slides);
          setAvailableSlides(allSlides);
          setSlide(allSlides.map((sld) => sld.id));
        } catch (error) {
          console.error("Error fetching slides:", error);
        }
      };
      fetchSlides();
    } else {
      setAvailableSlides([]);
    }
  }, [module, setSlide]);

  return (
    <div className="space-y-6">
      {/* Course Selection */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
            <svg
              className="w-4 h-4 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              Course Selection
            </h3>
            <p className="text-xs text-slate-600">
              Choose the course you want to study
            </p>
          </div>
        </div>
        <div className="relative">
          <select
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            className="w-full px-4 py-3 pr-10 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 bg-white/90 backdrop-blur-sm appearance-none cursor-pointer hover:border-blue-400 hover:bg-white/95"
          >
            <option value="" className="text-slate-500">
              Choose a course...
            </option>
            {courses.length > 0 &&
              courses.map((courseItem) => (
                <option
                  key={courseItem.course_id}
                  value={courseItem.course_id}
                  className="py-2 px-3 hover:bg-blue-50"
                >
                  {courseItem.course_title}
                </option>
              ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
            <svg
              className="w-5 h-5 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </div>

      {/* Modules Selection */}
      {course && (
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Module Selection
                </h3>
                <p className="text-xs text-slate-600">
                  Select the modules you want to include
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="select-all-modules"
                checked={module.length === availableModules.length}
                onChange={(e) =>
                  setModule(
                    e.target.checked
                      ? availableModules.map((mod: Module) => mod.module_id)
                      : []
                  )
                }
                className="w-4 h-4 text-emerald-600 border-emerald-300 rounded focus:ring-emerald-500 focus:ring-2 transition-all duration-200"
              />
              <label
                htmlFor="select-all-modules"
                className="text-sm text-emerald-700 font-medium cursor-pointer hover:text-emerald-800 transition-colors duration-200"
              >
                Select All
              </label>
            </div>
          </div>
          <div className="relative">
            <select
              multiple
              value={module}
              onChange={(e) =>
                setModule(
                  Array.from(e.target.selectedOptions, (option) => option.value)
                )
              }
              className="w-full px-4 py-3 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all duration-200 min-h-24 bg-white/90 backdrop-blur-sm appearance-none cursor-pointer hover:border-emerald-400 hover:bg-white/95"
            >
              {availableModules?.length > 0 &&
                availableModules.map((mod: Module) => (
                  <option
                    key={mod.module_id}
                    value={mod.module_id}
                    className="py-2 px-3 hover:bg-emerald-50 checked:bg-emerald-100"
                  >
                    {mod.module_title}
                  </option>
                ))}
            </select>
          </div>
          {module.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {module.map((moduleId) => {
                const selectedModule = availableModules.find(
                  (mod) => mod.module_id === moduleId
                );
                return selectedModule ? (
                  <span
                    key={moduleId}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-700 text-sm rounded-full border border-emerald-200"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {selectedModule.module_title}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      {/* Slides Selection */}
      {module.length > 0 && (
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                <svg
                  className="w-4 h-4 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Slide Selection
                </h3>
                <p className="text-xs text-slate-600">
                  Choose the specific slides to study
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="select-all-slides"
                checked={
                  availableSlides.length > 0 &&
                  slide.length === availableSlides.length
                }
                onChange={(e) =>
                  setSlide(
                    e.target.checked ? availableSlides.map((sld) => sld.id) : []
                  )
                }
                className="w-4 h-4 text-purple-600 border-purple-300 rounded focus:ring-purple-500 focus:ring-2 transition-all duration-200"
              />
              <label
                htmlFor="select-all-slides"
                className="text-sm text-purple-700 font-medium cursor-pointer hover:text-purple-800 transition-colors duration-200"
              >
                Select All
              </label>
            </div>
          </div>
          <div className="relative">
            <select
              multiple
              value={slide.map((s) => s)}
              onChange={(e) =>
                setSlide(
                  Array.from(e.target.selectedOptions, (option) => option.value)
                )
              }
              className="w-full px-4 py-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-200 min-h-24 bg-white/90 backdrop-blur-sm appearance-none cursor-pointer hover:border-purple-400 hover:bg-white/95"
            >
              {availableSlides?.length > 0 &&
                availableSlides.map((sld: Slide) => (
                  <option
                    key={sld.id}
                    value={sld.id}
                    className="py-2 px-3 hover:bg-purple-50 checked:bg-purple-100"
                  >
                    {sld.slide_title}
                  </option>
                ))}
            </select>
          </div>
          {slide.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {slide.map((slideId) => {
                const selectedSlide = availableSlides.find(
                  (sld) => sld.id === slideId
                );
                return selectedSlide ? (
                  <span
                    key={slideId}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-700 text-sm rounded-full border border-purple-200"
                  >
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {selectedSlide.slide_title}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onContinue}
        className="relative w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 overflow-hidden group"
      >
        {/* Subtle skewed background overlay on hover */}
        {!isAnyLoading && (
          <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 transition-all duration-500 transform -skew-x-6 scale-x-0 group-hover:scale-x-100 origin-left"></div>
        )}

        {/* Button content */}
        <div className="relative z-10 flex items-center justify-center gap-2">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7l5 5m0 0l-5 5m5-5H6"
            />
          </svg>
          Continue to Questions
        </div>
      </button>
    </div>
  );
}
