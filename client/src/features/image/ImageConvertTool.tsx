import { Alert, Box, Paper, Slider, Stack, TextField, Typography } from '@mui/material';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import { useCallback, useRef, useState } from 'react';
import ToolWorkflow from '@/components/ToolWorkflow';
import ConfigureLayout from '@/components/ConfigureLayout';
import FileList from '@/components/FileList';
import ImageResultsGrid from '@/components/ImageResultsGrid';
import { useToolWorkflow } from '@/hooks/useToolWorkflow';
import { useIncomingFiles } from '@/hooks/useIncomingFiles';
import { TOOL_BY_ID } from '@/constants/tools';
import { convertImage, convertedName, type ImageTarget } from '@/engines/imageConvert';
import { isEngineError, messageOf } from '@/engines/common';
import { acceptLabel, dropzoneAccept } from '@/utils/file';
import { formatBytes } from '@/utils/format';
import { numberOf } from '@/features/convert-from/resultMeta';

export interface ImageConvertToolProps {
  toolId: 'heic-to-jpg' | 'heif-to-jpg' | 'jpg-to-png' | 'png-to-jpg';
  target: ImageTarget;
  /** e.g. "HEIC photo", "PNG image" */
  kindLabel: string;
  /** the source format can contain transparency (shows the background colour option) */
  transparentSource?: boolean;
}

const PRESET_BACKGROUNDS = ['#ffffff', '#000000', '#f3f4f6'];

/**
 * Shared implementation for the image format converters. Every file is converted in the
 * browser; a file that fails is skipped with a warning so the rest of the batch still works.
 */
export default function ImageConvertTool({ toolId, target, kindLabel, transparentSource = false }: ImageConvertToolProps) {
  const tool = TOOL_BY_ID[toolId];
  const workflow = useToolWorkflow(tool, { minFiles: 1 });
  useIncomingFiles(workflow);
  const { files } = workflow;
  const inputRef = useRef<HTMLInputElement>(null);
  const [quality, setQuality] = useState(Math.max(60, workflow.settings.imageQuality));
  const [background, setBackground] = useState('#ffffff');
  const ext = target === 'jpeg' ? 'JPG' : 'PNG';
  const isHeif = tool.accept.includes('heic');

  const onConvert = useCallback(() => {
    void workflow.run(async (ctx) => {
      const outputs = [];
      const warnings: string[] = [];
      let downscaled = 0;
      let usedLibheif = false;
      for (let i = 0; i < ctx.files.length; i++) {
        const f = ctx.files[i];
        ctx.setStage(ctx.files.length > 1 ? `Converting ${i + 1} of ${ctx.files.length}...` : 'Converting...', ctx.files.length > 1 ? i / ctx.files.length : null);
        try {
          const r = await convertImage(ctx.getBlob(f.id), { target, quality, background, signal: ctx.signal });
          if (r.downscaled) downscaled++;
          if (r.decoder === 'libheif') usedLibheif = true;
          outputs.push({ name: convertedName(f.name, target), blob: r.blob, mimeType: r.blob.type });
        } catch (err) {
          if (isEngineError(err) && err.code === 'CANCELLED') throw err;
          if (ctx.files.length === 1) throw err;
          warnings.push(`${f.name}: ${messageOf(err)}`);
        }
      }
      if (!outputs.length) throw { code: 'CONVERSION_FAILED', message: 'None of the images could be converted.' };
      if (downscaled) warnings.push(`${downscaled} very large image${downscaled === 1 ? ' was' : 's were'} scaled down to about 16 megapixels because this browser cannot encode bigger canvases.`);
      if (isHeif) warnings.push('Only the main image of each file is converted (Live Photo motion and burst frames are not included). Photo metadata such as location and camera details is not copied.');
      const totalIn = ctx.files.reduce((n, f) => n + f.size, 0);
      const totalOut = outputs.reduce((n, o) => n + o.blob.size, 0);
      return { outputs, extra: { converted: outputs.length, failed: ctx.files.length - outputs.length, totalIn, totalOut, engine: usedLibheif ? 'libheif' : 'browser' }, warnings };
    }, 'Converting...');
  }, [workflow, target, quality, background, isHeif]);

  const plural = files.length === 1 ? '' : 's';
  const totalIn = numberOf(workflow.result?.extra, 'totalIn');
  const totalOut = numberOf(workflow.result?.extra, 'totalOut');

  return (
    <ToolWorkflow
      workflow={workflow}
      uploadTitle={`Drop your ${kindLabel}s here`}
      resultTitle="Conversion complete"
      resultDescription={workflow.outputs.length > 1 ? `${workflow.outputs.length} ${ext} images are ready. Download them one by one or all at once as a ZIP.` : `Your ${ext} image is ready.`}
      downloadLabel={workflow.outputs.length > 1 ? 'Download All (ZIP)' : `Download ${ext}`}
      processingHint={isHeif ? 'The HEIC decoder (about 3 MB) is downloaded the first time and cached afterwards.' : undefined}
      resultExtra={
        <>
          {totalIn !== undefined && totalOut !== undefined && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {formatBytes(totalIn)} → {formatBytes(totalOut)}
                {target === 'png' && totalOut > totalIn ? ' · PNG is lossless, so files are usually larger than the JPG originals.' : ''}
              </Typography>
            </Paper>
          )}
          <ImageResultsGrid workflow={workflow} />
        </>
      }
      configure={
        <ConfigureLayout
          actionLabel={tool.actionLabel}
          actionIcon={<SwapHorizRoundedIcon />}
          actionDisabled={files.length === 0}
          onAction={onConvert}
          summary={`${files.length} ${kindLabel}${plural} will be converted to ${ext}.`}
          onBack={workflow.reset}
          backLabel="Start over"
          options={
            <>
              {target === 'jpeg' && (
                <Box>
                  <Typography id="jpg-quality-label" variant="subtitle2" sx={{ fontWeight: 600 }}>
                    JPG quality: {quality}
                  </Typography>
                  <Slider
                    aria-labelledby="jpg-quality-label"
                    value={quality}
                    min={10}
                    max={100}
                    step={5}
                    marks={[
                      { value: 10, label: 'Small' },
                      { value: 100, label: 'Best' },
                    ]}
                    valueLabelDisplay="auto"
                    onChange={(_, v) => setQuality(Array.isArray(v) ? v[0] : v)}
                  />
                  <Typography variant="caption" color="text.secondary">
                    85–92 keeps photos visually identical with much smaller files.
                  </Typography>
                </Box>
              )}
              {target === 'jpeg' && transparentSource && (
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }} id="bg-label">
                    Background for transparent areas
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {PRESET_BACKGROUNDS.map((c) => (
                      <Box
                        key={c}
                        component="button"
                        type="button"
                        aria-label={`Use ${c} as background`}
                        aria-pressed={background === c}
                        onClick={() => setBackground(c)}
                        sx={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          bgcolor: c,
                          cursor: 'pointer',
                          border: 2,
                          borderColor: background === c ? 'primary.main' : 'divider',
                          outlineOffset: 2,
                        }}
                      />
                    ))}
                    <TextField
                      type="color"
                      size="small"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      slotProps={{ htmlInput: { 'aria-labelledby': 'bg-label' } }}
                      sx={{ width: 64 }}
                    />
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    JPG cannot store transparency, so transparent pixels are filled with this colour.
                  </Typography>
                </Box>
              )}
              {target === 'png' && (
                <Typography variant="body2" color="text.secondary">
                  PNG is lossless: the converted image keeps exactly the pixels of the original. There is nothing to configure.
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                Supported: {acceptLabel(tool.accept)}. The image size in pixels is kept.
              </Typography>
            </>
          }
        >
          <Stack spacing={2}>
            <Alert severity="info">
              Conversion happens in your browser. Nothing is uploaded, and your photos never leave your device.
              {isHeif && ' Previews of HEIC files may not be shown in this list in browsers other than Safari; the conversion still works.'}
            </Alert>
            <FileList
              files={files}
              onRemove={workflow.removeFile}
              onRename={workflow.renameFile}
              onReorder={files.length > 1 ? workflow.setOrder : undefined}
              onAddMore={() => inputRef.current?.click()}
              addMoreLabel="Add more"
            />
            <Box>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={Object.values(dropzoneAccept(tool.accept)).flat().join(',')}
                hidden
                aria-label={`Add more ${kindLabel}s`}
                onChange={(e) => {
                  const list = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (list.length) void workflow.addFiles(list);
                }}
              />
            </Box>
          </Stack>
        </ConfigureLayout>
      }
    />
  );
}
