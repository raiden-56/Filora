import { Box, Card, CardActionArea, Typography, alpha } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { Link as RouterLink } from 'react-router-dom';
import type { ToolDefinition } from '@/types';
import { CATEGORY_BY_ID, toolPath } from '@/constants/tools';
import ToolIcon from './ToolIcon';
import { memo } from 'react';

export interface ToolCardProps {
  tool: ToolDefinition;
  compact?: boolean;
}

function ToolCardInner({ tool, compact = false }: ToolCardProps) {
  const color = CATEGORY_BY_ID[tool.category].color;
  return (
    <Card
      sx={{
        height: '100%',
        transition: 'transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease',
        '&:hover, &:focus-within': {
          transform: 'translateY(-3px)',
          boxShadow: 6,
          borderColor: alpha(color, 0.5),
          '& .tool-arrow': { transform: 'translateX(4px)', opacity: 1 },
        },
      }}
    >
      <CardActionArea
        component={RouterLink}
        to={toolPath(tool)}
        aria-label={`${tool.name}: ${tool.description}`}
        sx={{ height: '100%', p: compact ? 2 : 2.5, display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1.5 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box
            sx={{
              width: compact ? 40 : 48,
              height: compact ? 40 : 48,
              borderRadius: '14px',
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha(color, 0.12),
              color,
              '& svg': { fontSize: compact ? 22 : 26 },
            }}
          >
            <ToolIcon name={tool.icon} />
          </Box>
          <ArrowForwardRoundedIcon
            className="tool-arrow"
            sx={{ color: 'text.disabled', opacity: 0.5, transition: 'transform 160ms ease, opacity 160ms ease' }}
          />
        </Box>
        <Box>
          <Typography variant={compact ? 'subtitle1' : 'h6'} sx={{ fontWeight: 700, mb: 0.5 }}>
            {tool.name}
          </Typography>
          {!compact && (
            <Typography variant="body2" color="text.secondary">
              {tool.description}
            </Typography>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}

const ToolCard = memo(ToolCardInner);
export default ToolCard;
