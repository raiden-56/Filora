import {
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { clearHistory, removeHistoryItem, renameHistoryItem } from '@/store/slices/historySlice';
import { showSnackbar } from '@/store/slices/uiSlice';
import { clearOutputs, deleteOutput, loadOutputBlob, renameOutput } from '@/services/storage';
import { downloadBlob } from '@/services/download';
import { formatBytes, formatDate, relativeTime } from '@/utils/format';
import { fileKindLabel } from '@/utils/file';
import { useDebounce } from '@/hooks/useDebounce';
import { useIsMobile } from '@/hooks/useIsMobile';
import ConfirmDialog from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import Modal from '@/components/Modal';
import { useObjectUrl } from '@/hooks/useObjectUrl';
import type { HistoryItem } from '@/types';
import { TOOL_BY_ID, toolPath } from '@/constants/tools';

const PDFViewer = lazy(() => import('@/components/PDFViewer'));

function ImagePreview({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob);
  return url ? <Box component="img" src={url} alt="Preview" sx={{ maxWidth: '100%', maxHeight: '75vh', mx: 'auto', display: 'block' }} /> : null;
}

export default function MyFilesPage() {
  const dispatch = useAppDispatch();
  const items = useAppSelector((s) => s.history.items);
  const loaded = useAppSelector((s) => s.history.loaded);
  const settings = useAppSelector((s) => s.settings);
  const mobile = useIsMobile();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 150);
  const [confirm, setConfirm] = useState<{ id?: string; all?: boolean } | null>(null);
  const [rename, setRename] = useState<HistoryItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [preview, setPreview] = useState<{ item: HistoryItem; blob: Blob } | null>(null);
  const [menu, setMenu] = useState<{ el: HTMLElement; item: HistoryItem } | null>(null);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.toolName.toLowerCase().includes(q)) : items;
  }, [items, debounced]);

  const getBlob = async (item: HistoryItem) => {
    const blob = await loadOutputBlob(item.id);
    if (!blob) {
      dispatch(showSnackbar('This file is no longer available. It may have been cleared by your browser.', 'warning'));
      dispatch(removeHistoryItem(item.id));
    }
    return blob;
  };

  const onDownload = async (item: HistoryItem) => {
    const blob = await getBlob(item);
    if (blob) downloadBlob(blob, item.name);
  };
  const onPreview = async (item: HistoryItem) => {
    const blob = await getBlob(item);
    if (blob) setPreview({ item, blob });
  };
  const onDelete = async () => {
    if (!confirm) return;
    if (confirm.all) {
      await clearOutputs();
      dispatch(clearHistory());
      dispatch(showSnackbar('All files deleted.', 'success'));
    } else if (confirm.id) {
      await deleteOutput(confirm.id);
      dispatch(removeHistoryItem(confirm.id));
      dispatch(showSnackbar('File deleted.', 'success'));
    }
    setConfirm(null);
  };
  const onRename = async () => {
    if (!rename) return;
    const name = renameValue.trim();
    if (name) {
      await renameOutput(rename.id, name);
      dispatch(renameHistoryItem({ id: rename.id, name }));
    }
    setRename(null);
  };

  const canPreview = (i: HistoryItem) => i.mimeType === 'application/pdf' || i.mimeType.startsWith('image/');

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-end' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h2" component="h1" sx={{ mb: 0.5 }}>
            My Files
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Recently processed files are stored in this browser only.
            {settings.autoDeleteFiles && settings.autoDeleteAfterHours > 0 && ` They are deleted automatically after ${settings.autoDeleteAfterHours} hours.`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
            size="small"
            slotProps={{
              htmlInput: { 'aria-label': 'Search files' },
              input: { startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> },
            }}
          />
          {items.length > 0 && (
            <Button color="error" variant="outlined" onClick={() => setConfirm({ all: true })}>
              Delete all
            </Button>
          )}
        </Stack>
      </Stack>

      {loaded && items.length === 0 ? (
        <EmptyState icon={<FolderOpenRoundedIcon />} title="No files yet" description="Files you process with any tool will show up here for quick access." actionLabel="Choose a PDF Tool">
          <Button component={RouterLink} to="/tools" variant="contained" sx={{ mt: 1 }}>
            Choose a PDF Tool
          </Button>
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching files" description={`Nothing matches “${query}”.`} actionLabel="Clear search" onAction={() => setQuery('')} />
      ) : mobile ? (
        <Stack spacing={1.5} role="list" aria-label="Files">
          {filtered.map((item) => (
            <Paper key={item.id} variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }} role="listitem">
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
                  {item.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {fileKindLabel(item.mimeType, item.name)} · {formatBytes(item.size)} · {relativeTime(item.createdAt)}
                </Typography>
              </Box>
              <IconButton aria-label={`Download ${item.name}`} onClick={() => void onDownload(item)}>
                <DownloadRoundedIcon />
              </IconButton>
              <IconButton aria-label={`More actions for ${item.name}`} onClick={(e) => setMenu({ el: e.currentTarget, item })}>
                <MoreVertRoundedIcon />
              </IconButton>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table aria-label="Files">
            <TableHead>
              <TableRow>
                <TableCell>File name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Size</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Tool</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell sx={{ maxWidth: 360 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }} title={item.name}>
                      {item.name}
                    </Typography>
                    {item.pageCount ? (
                      <Typography variant="caption" color="text.secondary">
                        {item.pageCount} page{item.pageCount === 1 ? '' : 's'}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={fileKindLabel(item.mimeType, item.name)} />
                  </TableCell>
                  <TableCell>{formatBytes(item.size)}</TableCell>
                  <TableCell>
                    <Tooltip title={formatDate(item.createdAt)}>
                      <span>{relativeTime(item.createdAt)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {TOOL_BY_ID[item.toolId] ? (
                      <Button component={RouterLink} to={toolPath(TOOL_BY_ID[item.toolId])} size="small" sx={{ px: 1 }}>
                        {item.toolName}
                      </Button>
                    ) : (
                      item.toolName
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {canPreview(item) && (
                      <Tooltip title="Preview">
                        <IconButton aria-label={`Preview ${item.name}`} onClick={() => void onPreview(item)}>
                          <VisibilityRoundedIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Download">
                      <IconButton aria-label={`Download ${item.name}`} onClick={() => void onDownload(item)}>
                        <DownloadRoundedIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Rename">
                      <IconButton
                        aria-label={`Rename ${item.name}`}
                        onClick={() => {
                          setRename(item);
                          setRenameValue(item.name);
                        }}
                      >
                        <EditRoundedIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton aria-label={`Delete ${item.name}`} color="error" onClick={() => setConfirm({ id: item.id })}>
                        <DeleteOutlineRoundedIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <Menu open={Boolean(menu)} anchorEl={menu?.el} onClose={() => setMenu(null)}>
        {menu && canPreview(menu.item) && (
          <MenuItem
            onClick={() => {
              void onPreview(menu.item);
              setMenu(null);
            }}
          >
            Preview
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            if (menu) {
              setRename(menu.item);
              setRenameValue(menu.item.name);
            }
            setMenu(null);
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menu) setConfirm({ id: menu.item.id });
            setMenu(null);
          }}
          sx={{ color: 'error.main' }}
        >
          Delete
        </MenuItem>
      </Menu>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.all ? 'Delete all files?' : 'Delete this file?'}
        message={confirm?.all ? 'All files stored in this browser will be permanently removed.' : 'This file will be permanently removed from My Files.'}
        confirmLabel="Delete"
        destructive
        onConfirm={() => void onDelete()}
        onClose={() => setConfirm(null)}
      />

      <Modal open={Boolean(rename)} onClose={() => setRename(null)} title="Rename file" maxWidth="xs" fullScreen={false} id="rename" actions={<><Button onClick={() => setRename(null)} color="inherit">Cancel</Button><Button variant="contained" onClick={() => void onRename()}>Save</Button></>}>
        <TextField
          autoFocus
          fullWidth
          label="File name"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onRename();
          }}
          sx={{ mt: 1 }}
        />
      </Modal>

      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.item.name} maxWidth="lg" disablePadding={preview?.item.mimeType === 'application/pdf'} id="file-preview">
        {preview?.item.mimeType === 'application/pdf' && (
          <Suspense fallback={<Box sx={{ p: 4 }}>Loading preview…</Box>}>
            <Box sx={{ height: { xs: 'calc(100vh - 64px)', sm: '75vh' } }}>
              <PDFViewer fileId={preview.item.id} ns="blob" blob={preview.blob} />
            </Box>
          </Suspense>
        )}
        {preview?.item.mimeType.startsWith('image/') && <ImagePreview blob={preview.blob} />}
      </Modal>
    </Container>
  );
}
