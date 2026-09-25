import { Alert, AlertTitle, type SxProps, type Theme } from '@mui/material';
import { useEffect, useState } from 'react';
import { getServerCapabilities, type ServerCapabilities } from '@/services/api';

export type ServerCapabilityName = 'libreoffice' | 'ghostscript' | 'puppeteer';

const CAPABILITY_LABELS: Record<ServerCapabilityName, string> = {
  libreoffice: 'LibreOffice',
  ghostscript: 'Ghostscript',
  puppeteer: 'Chromium (Puppeteer)',
};

let capabilitiesPromise: Promise<ServerCapabilities> | null = null;

/**
 * Fetches the server capabilities once per session and shares the result between all tools.
 * A failed request is not cached so the next tool that mounts retries.
 */
function loadServerCapabilities(): Promise<ServerCapabilities> {
  if (!capabilitiesPromise) {
    capabilitiesPromise = getServerCapabilities().catch((err: unknown) => {
      capabilitiesPromise = null;
      throw err;
    });
  }
  return capabilitiesPromise;
}

export interface ServerToolNoticeProps {
  /** optional server components this tool uses for best results */
  needs?: ServerCapabilityName[];
  /** message shown when one of the `needs` is missing */
  message?: string;
  sx?: SxProps<Theme>;
}

type NoticeState = { status: 'loading' } | { status: 'ok' } | { status: 'missing'; missing: ServerCapabilityName[] } | { status: 'offline' };

/**
 * Small alert for server-backed tools: warns when an optional server component is missing
 * (lower fidelity) and errors when the processing server cannot be reached at all.
 */
export default function ServerToolNotice({ needs = [], message, sx }: ServerToolNoticeProps) {
  const [state, setState] = useState<NoticeState>({ status: 'loading' });
  const needsKey = needs.join(',');

  useEffect(() => {
    let cancelled = false;
    loadServerCapabilities()
      .then((caps) => {
        if (cancelled) return;
        const missing = (needsKey ? (needsKey.split(',') as ServerCapabilityName[]) : []).filter((n) => !caps[n]);
        setState(missing.length ? { status: 'missing', missing } : { status: 'ok' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'offline' });
      });
    return () => {
      cancelled = true;
    };
  }, [needsKey]);

  if (state.status === 'offline') {
    return (
      <Alert severity="error" sx={sx} role="alert">
        <AlertTitle>Processing server unavailable</AlertTitle>
        The processing server is not reachable. Start it with <code>npm run dev:server</code>.
      </Alert>
    );
  }
  if (state.status === 'missing') {
    const names = state.missing.map((m) => CAPABILITY_LABELS[m]).join(', ');
    return (
      <Alert severity="warning" sx={sx}>
        {message ?? `${names} ${state.missing.length === 1 ? 'is' : 'are'} not installed on the server. The built-in converter will be used instead, which may give lower fidelity.`}
      </Alert>
    );
  }
  return null;
}
