import OfficeToPdfTool from './OfficeToPdfTool';

export default function ExcelToPdfTool() {
  return <OfficeToPdfTool toolId="excel-to-pdf" endpoint="/convert/excel-to-pdf" kindLabel="spreadsheet" />;
}
