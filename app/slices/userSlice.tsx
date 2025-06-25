import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserState {
  participantId: string | null;
  answers: Record<string, string>; // question_id -> answer
  draftAnswer: string | null; // 无 question_id 时的 answer
  draftQuestion: string | null; // 无 question_id 时的 question
}

const initialState: UserState = {
  participantId: null,
  answers: {},
  draftAnswer: null,
  draftQuestion: null,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setParticipantId: (state, action: PayloadAction<string>) => {
      state.participantId = action.payload;
    },
    saveAnswer: (state, action: PayloadAction<{ questionId: string; answer: string }>) => {
      const { questionId, answer } = action.payload;
      state.answers[questionId] = answer;
    },
    saveDraftAnswer: (state, action: PayloadAction<string>) => {
      state.draftAnswer = action.payload;
    },
    saveDraftQuestion: (state, action: PayloadAction<string>) => {
      state.draftQuestion = action.payload;
    },
  },
});

export const { setParticipantId, saveAnswer, saveDraftAnswer, saveDraftQuestion } = userSlice.actions;
export default userSlice.reducer;
