'use client';

import { useEffect } from "react";

const CourseAssignment: React.FC = () => {
  useEffect(() => {
    const urls: string[] = [
      "https://proton.oli.cmu.edu/sections/join/r5jc6", // Version A
      "https://proton.oli.cmu.edu/sections/join/e5zdv", // Version B
      "https://proton.oli.cmu.edu/sections/join/pyr3x", // Version C
      "https://proton.oli.cmu.edu/sections/join/y0s5y", // Version D
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
