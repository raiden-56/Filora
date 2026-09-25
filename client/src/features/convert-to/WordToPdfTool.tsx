import OfficeToPdfTool from './OfficeToPdfTool';

export default function WordToPdfTool() {
  return <OfficeToPdfTool toolId="word-to-pdf" endpoint="/convert/word-to-pdf" kindLabel="Word document" />;
}
