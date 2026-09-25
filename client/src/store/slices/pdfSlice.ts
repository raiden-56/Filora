import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface PdfPageInfo {
  width: number;
  height: number;
  rotation: number;
}

export interface PdfDocInfo {
  fileId: string;
  pageCount: number;
  pages: PdfPageInfo[];
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

/** Cache of parsed PDF information per file id (page counts, sizes, rotations). */
export interface PdfState {
  docs: Record<string, PdfDocInfo>;
}

const initialState: PdfState = { docs: {} };

const pdfSlice = createSlice({
  name: 'pdf',
  initialState,
  reducers: {
    setPdfLoading: (state, action: PayloadAction<string>) => {
      state.docs[action.payload] = { fileId: action.payload, pageCount: 0, pages: [], status: 'loading' };
    },
    setPdfInfo: (state, action: PayloadAction<Omit<PdfDocInfo, 'status'>>) => {
      state.docs[action.payload.fileId] = { ...action.payload, status: 'ready' };
    },
    setPdfError: (state, action: PayloadAction<{ fileId: string; error: string }>) => {
      state.docs[action.payload.fileId] = {
        fileId: action.payload.fileId,
        pageCount: 0,
        pages: [],
        status: 'error',
        error: action.payload.error,
      };
    },
    removePdfInfo: (state, action: PayloadAction<string>) => {
      delete state.docs[action.payload];
    },
    clearPdfInfo: (state) => {
      state.docs = {};
    },
  },
});

export const { setPdfLoading, setPdfInfo, setPdfError, removePdfInfo, clearPdfInfo } = pdfSlice.actions;
export default pdfSlice.reducer;
