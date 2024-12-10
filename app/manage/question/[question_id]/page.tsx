'use client'

import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Question } from '../page';
import Image from 'next/image';

const ManageQuestion = () => {
  const pathname = usePathname();
  const pathnames = pathname.split('/');
  const questionId = pathnames[pathnames.length - 1];

  const [question, setQuestion] = useState<Question>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (questionId) {
      axios.get(`/api/questions/by_id/${questionId}`)
    .then(res => {
      setQuestion(res.data)
    })
    .catch(error => {
      console.error('Error fetching question:', error);
    })
    .finally(() => {
      setLoading(false);
    })
    }
  }, [questionId]);


  if (loading) {
    return <p>Loading...</p>;
  }

  if (!question) {
    return <p>Question not found</p>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Question {question.question_id}</h1>
      <p className="mb-2"><strong>Type:</strong> {question.type}</p>
      <div className="mb-4">
        <strong>Content:</strong>
        {question.content.map((item, index) => (
          <div key={index} className="mt-2">
            {item.type === 'text' ? (
              <p>{item.content}</p>
            ) : item.type === 'image' ? (
              <Image src={item.content} alt={`Question content ${index + 1}`} className="max-w-xs" />
            ) : null}
          </div>
        ))}
      </div>
      <p className="mb-2"><strong>Options:</strong> {question.options?.join(', ') || 'N/A'}</p>
      <p className="mb-2"><strong>Slide IDs:</strong> {question.slide_ids?.join(', ') || 'N/A'}</p>
      <p className="mb-2"><strong>Objective:</strong> {question.objective?.join(', ') || 'N/A'}</p>
    </div>
  );
};

export default ManageQuestion;