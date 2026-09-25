import type { SvgIconProps } from '@mui/material/SvgIcon';
import CallMergeRoundedIcon from '@mui/icons-material/CallMergeRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import FileCopyRoundedIcon from '@mui/icons-material/FileCopyRounded';
import DashboardCustomizeRoundedIcon from '@mui/icons-material/DashboardCustomizeRounded';
import DocumentScannerRoundedIcon from '@mui/icons-material/DocumentScannerRounded';
import CompressRoundedIcon from '@mui/icons-material/CompressRounded';
import HealingRoundedIcon from '@mui/icons-material/HealingRounded';
import ManageSearchRoundedIcon from '@mui/icons-material/ManageSearchRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import SlideshowRoundedIcon from '@mui/icons-material/SlideshowRounded';
import TableChartRoundedIcon from '@mui/icons-material/TableChartRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import InventoryRoundedIcon from '@mui/icons-material/InventoryRounded';
import Rotate90DegreesCwRoundedIcon from '@mui/icons-material/Rotate90DegreesCwRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import BrandingWatermarkRoundedIcon from '@mui/icons-material/BrandingWatermarkRounded';
import CropRoundedIcon from '@mui/icons-material/CropRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import BallotRoundedIcon from '@mui/icons-material/BallotRounded';
import PictureAsPdfRoundedIcon from '@mui/icons-material/PictureAsPdfRounded';

const ICONS: Record<string, React.ComponentType<SvgIconProps>> = {
  merge: CallMergeRoundedIcon,
  split: CallSplitRoundedIcon,
  remove: DeleteSweepRoundedIcon,
  extract: FileCopyRoundedIcon,
  organize: DashboardCustomizeRoundedIcon,
  scan: DocumentScannerRoundedIcon,
  compress: CompressRoundedIcon,
  repair: HealingRoundedIcon,
  ocr: ManageSearchRoundedIcon,
  image: ImageRoundedIcon,
  word: DescriptionRoundedIcon,
  powerpoint: SlideshowRoundedIcon,
  excel: TableChartRoundedIcon,
  html: CodeRoundedIcon,
  archive: InventoryRoundedIcon,
  rotate: Rotate90DegreesCwRoundedIcon,
  numbers: FormatListNumberedRoundedIcon,
  watermark: BrandingWatermarkRoundedIcon,
  crop: CropRoundedIcon,
  edit: EditNoteRoundedIcon,
  forms: BallotRoundedIcon,
  pdf: PictureAsPdfRoundedIcon,
};

export interface ToolIconProps extends SvgIconProps {
  name: string;
}

export default function ToolIcon({ name, ...props }: ToolIconProps) {
  const Icon = ICONS[name] ?? PictureAsPdfRoundedIcon;
  return <Icon {...props} />;
}
