'use client';

import { useEffect } from "react";

const CourseAssignment: React.FC = () => {
  useEffect(() => {
    const urls: string[] = [
      "https://proton.oli.cmu.edu/sections/join/t7k25", // change to four different joins
      "https://proton.oli.cmu.edu/sections/join/t7k25",
      "https://proton.oli.cmu.edu/sections/join/t7k25",
      "https://proton.oli.cmu.edu/sections/join/t7k25" 
    ];

    const getRandomIndex = (max: number): number => {
      const array = new Uint32Array(1);
      window.crypto.getRandomValues(array);
      return array[0] % max;
    };

    const randomUrl = urls[getRandomIndex(urls.length)];
    window.location.href = randomUrl;
  }, []);

  return (
    <div>
      <h1>Redirecting...</h1>
      <p>Please wait while we redirect you to the appropriate version.</p>
    </div>
  );
};

export default CourseAssignment;
