/**
 * Utility functions for sending practice completion signals to Qualtrics
 * when embedded as iframe
 */

interface CompletionCriteria {
  attempts: number;
  correctAnswers: number;
}

interface QualtricsSignalData {
  action: 'practiceComplete';
  questionId: string;
  participantId: string;
  version?: string;
  criteria: CompletionCriteria;
  timestamp: number;
}

/**
 * Check if completion criteria are met (3 attempts OR 1 correct answer)
 */
export function checkCompletionCriteria(attempts: number, correctAnswers: number): boolean {
  return attempts >= 3 || correctAnswers >= 1;
}

/**
 * Send completion signal to parent window (Qualtrics)
 */
export function sendQualtricsCompletionSignal(
  questionId: string,
  participantId: string,
  attempts: number,
  correctAnswers: number,
  version?: string
): void {
  try {
    const signalData: QualtricsSignalData = {
      action: 'practiceComplete',
      questionId,
      participantId,
      version,
      criteria: {
        attempts,
        correctAnswers
      },
      timestamp: Date.now()
    };

    // Send to parent window (Qualtrics iframe)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(signalData, '*');
      console.log('Qualtrics completion signal sent:', signalData);
    }

    // Also dispatch custom event for other listeners
    const event = new CustomEvent('qualtricsCompletion', {
      detail: signalData
    });
    window.dispatchEvent(event);

  } catch (error) {
    console.error('Failed to send Qualtrics completion signal:', error);
  }
}

/**
 * Track attempt and check for completion in localStorage
 */
export function trackAttemptAndCheckCompletion(
  questionId: string,
  participantId: string,
  isCorrect: boolean,
  version?: string
): boolean {
  try {
    const storageKey = `practice_${questionId}_${participantId}`;
    
    // Get existing data
    const existingData = localStorage.getItem(storageKey);
    let data = {
      attempts: 0,
      correctAnswers: 0,
      completed: false
    };

    if (existingData) {
      data = JSON.parse(existingData);
    }

    // Increment attempts
    data.attempts++;
    
    // Increment correct answers if applicable
    if (isCorrect) {
      data.correctAnswers++;
    }

    // Check completion criteria
    const isComplete = checkCompletionCriteria(data.attempts, data.correctAnswers);
    
    if (isComplete && !data.completed) {
      data.completed = true;
      sendQualtricsCompletionSignal(
        questionId,
        participantId,
        data.attempts,
        data.correctAnswers,
        version
      );
    }

    // Save updated data
    localStorage.setItem(storageKey, JSON.stringify(data));

    return isComplete;
  } catch (error) {
    console.error('Failed to track attempt:', error);
    return false;
  }
}

/**
 * Get current practice status for a question
 */
export function getPracticeStatus(questionId: string, participantId: string): {
  attempts: number;
  correctAnswers: number;
  completed: boolean;
} {
  try {
    const storageKey = `practice_${questionId}_${participantId}`;
    const existingData = localStorage.getItem(storageKey);
    
    if (existingData) {
      return JSON.parse(existingData);
    }
  } catch (error) {
    console.error('Failed to get practice status:', error);
  }

  return {
    attempts: 0,
    correctAnswers: 0,
    completed: false
  };
}

/**
 * Reset practice data for a question (for testing)
 */
export function resetPracticeData(questionId: string, participantId: string): void {
  try {
    const storageKey = `practice_${questionId}_${participantId}`;
    localStorage.removeItem(storageKey);
    console.log(`Practice data reset for ${questionId}`);
  } catch (error) {
    console.error('Failed to reset practice data:', error);
  }
}