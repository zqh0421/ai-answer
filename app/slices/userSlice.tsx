import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserState {
  participantId: string | null; // 用户唯一标识
  answers: Record<string, string>; // question_id -> answer
}

const initialState: UserState = {
  participantId: null,
  answers: {},
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
  },
});

export const { setParticipantId, saveAnswer } = userSlice.actions;
export default userSlice.reducer;
