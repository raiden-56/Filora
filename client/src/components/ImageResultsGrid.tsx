import { Box, Card, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import type { ToolWorkflow } from '@/hooks/useToolWorkflow';
import { outputRegistry } from '@/services/fileRegistry';
import { formatBytes } from '@/utils/format';

/** Thumbnail grid of image outputs with a download button per image (result screen of image tools). */
export default function ImageResultsGrid({ workflow }: { workflow: ToolWorkflow }) {
  const { outputs } = workflow;
  if (!outputs.length) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="image-results">
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
        {outputs.length} image{outputs.length === 1 ? '' : 's'}
      </Typography>
      <Box role="list" aria-label="Converted images" sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {outputs.map((o, i) => {
          const url = outputRegistry.objectUrl(o.id);
          return (
            <Card key={o.id} role="listitem" variant="outlined" sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ aspectRatio: '0.707', display: 'grid', placeItems: 'center', bgcolor: 'action.hover', borderRadius: 1.5, overflow: 'hidden' }}>
                {url ? (
                  <Box component="img" src={url} alt={`Image ${i + 1}: ${o.name}`} loading="lazy" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }} />
                ) : (
                  <ImageRoundedIcon color="disabled" />
                )}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, minWidth: 0 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="caption" noWrap display="block" title={o.name} sx={{ fontWeight: 600 }}>
                    {o.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatBytes(o.size)}
                  </Typography>
                </Box>
                <Tooltip title="Download">
                  <IconButton size="small" aria-label={`Download ${o.name}`} onClick={() => workflow.downloadOutput(o.id)} sx={{ minWidth: 44, minHeight: 44 }}>
                    <DownloadRoundedIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Card>
          );
        })}
      </Box>
    </Paper>
  );
}
