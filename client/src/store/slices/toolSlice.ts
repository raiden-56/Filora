import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AppError, ProcessingStage, ToolResultMeta, WorkflowStep } from '@/types';

export interface ToolState {
  /** id of the tool currently open */
  activeToolId: string | null;
  step: WorkflowStep;
  stage: ProcessingStage | string;
  /** 0-100, or null for indeterminate */
  progress: number | null;
  error: AppError | null;
  result: ToolResultMeta | null;
}

const initialState: ToolState = {
  activeToolId: null,
  step: 'upload',
  stage: 'Processing...',
  progress: null,
  error: null,
  result: null,
};

const toolSlice = createSlice({
  name: 'tool',
  initialState,
  reducers: {
    openTool: (state, action: PayloadAction<string>) => {
      if (state.activeToolId !== action.payload) {
        state.activeToolId = action.payload;
        state.step = 'upload';
        state.stage = 'Processing...';
        state.progress = null;
        state.error = null;
        state.result = null;
      }
    },
    setStep: (state, action: PayloadAction<WorkflowStep>) => {
      state.step = action.payload;
    },
    startProcessing: (state, action: PayloadAction<ProcessingStage | string | undefined>) => {
      state.step = 'processing';
      state.stage = action.payload ?? 'Processing...';
      state.progress = null;
      state.error = null;
      state.result = null;
    },
    setProgress: (state, action: PayloadAction<{ stage?: ProcessingStage | string; progress?: number | null }>) => {
      if (action.payload.stage !== undefined) state.stage = action.payload.stage;
      if (action.payload.progress !== undefined) state.progress = action.payload.progress;
    },
    finishProcessing: (state, action: PayloadAction<ToolResultMeta>) => {
      state.step = 'done';
      state.result = action.payload;
      state.progress = 100;
      state.error = null;
    },
    failProcessing: (state, action: PayloadAction<AppError>) => {
      state.step = 'configure';
      state.error = action.payload;
      state.progress = null;
    },
    clearToolError: (state) => {
      state.error = null;
    },
    resetTool: (state) => {
      state.step = 'upload';
      state.stage = 'Processing...';
      state.progress = null;
      state.error = null;
      state.result = null;
    },
  },
});

export const {
  openTool,
  setStep,
  startProcessing,
  setProgress,
  finishProcessing,
  failProcessing,
  clearToolError,
  resetTool,
} = toolSlice.actions;
export default toolSlice.reducer;
