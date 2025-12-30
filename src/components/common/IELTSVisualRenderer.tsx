import { cn } from '@/lib/utils';

// Chart data types for different visual types
export interface ChartDataItem {
  label: string;
  value: number;
  color?: string;
}

export interface LineDataPoint {
  x: string | number;
  y: number;
}

export interface LineSeriesData {
  name: string;
  data: LineDataPoint[];
  color?: string;
}

export interface TableCell {
  value: string | number;
  isHeader?: boolean;
}

export interface ProcessStep {
  label: string;
  description?: string;
}

export interface MapFeature {
  label: string;
  type: 'building' | 'road' | 'park' | 'water' | 'other';
  position?: string;
}

export interface MapData {
  before?: { year: string; features: MapFeature[] };
  after?: { year: string; features: MapFeature[] };
  features?: MapFeature[];
}

// Main chart data interface
export interface IELTSChartData {
  type: 'BAR_CHART' | 'LINE_GRAPH' | 'PIE_CHART' | 'TABLE' | 'PROCESS_DIAGRAM' | 'MAP' | 'MIXED_CHARTS';
  title: string;
  subtitle?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
  data?: ChartDataItem[];
  series?: LineSeriesData[];
  rows?: TableCell[][];
  headers?: string[];
  steps?: ProcessStep[];
  mapData?: MapData;
  charts?: IELTSChartData[]; // For mixed charts
}

// Default colors for charts - highly distinguishable palette like official IELTS
const CHART_COLORS = [
  '#3366CC', // Strong blue
  '#DC3912', // Strong red
  '#109618', // Strong green
  '#FF9900', // Orange
  '#990099', // Purple
  '#0099C6', // Teal
  '#DD4477', // Pink
  '#66AA00', // Lime green
];

interface IELTSVisualRendererProps {
  chartData: IELTSChartData | null | undefined;
  fallbackDescription?: string;
  className?: string;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Renders IELTS Task 1 visuals from JSON data using CSS.
 * Handles: Bar Charts, Line Graphs, Pie Charts, Tables, Process Diagrams, Maps, Mixed Charts
 */
export function IELTSVisualRenderer({
  chartData,
  fallbackDescription = 'Visual data not available',
  className = '',
}: IELTSVisualRendererProps) {
  
  // Show placeholder if no data
  if (!chartData || !chartData.type) {
    return (
      <div 
        className={cn(
          'flex flex-col items-center justify-center p-6 bg-muted/30 text-center w-full',
          className
        )}
        style={{ minHeight: 200 }}
      >
        <div className="text-muted-foreground text-sm mb-2">📊</div>
        <p className="text-sm text-muted-foreground">{fallbackDescription}</p>
      </div>
    );
  }

  const getColor = (index: number, customColor?: string) => 
    customColor || CHART_COLORS[index % CHART_COLORS.length];

  // Render based on chart type
  const renderChart = () => {
    switch (chartData.type) {
      case 'BAR_CHART':
        return <BarChartRenderer data={chartData} getColor={getColor} />;
      case 'LINE_GRAPH':
        return <LineGraphRenderer data={chartData} getColor={getColor} />;
      case 'PIE_CHART':
        return <PieChartRenderer data={chartData} getColor={getColor} />;
      case 'TABLE':
        return <TableRenderer data={chartData} />;
      case 'PROCESS_DIAGRAM':
        return <ProcessDiagramRenderer data={chartData} />;
      case 'MAP':
        return <MapRenderer data={chartData} />;
      case 'MIXED_CHARTS':
        return <MixedChartsRenderer data={chartData} getColor={getColor} />;
      default:
        return (
          <div className="text-center text-muted-foreground p-4">
            <p>Unknown chart type: {chartData.type}</p>
            <p className="text-xs mt-2">{fallbackDescription}</p>
          </div>
        );
    }
  };

  return (
    <div className={cn('w-full', className)}>
      {chartData.title && (
        <h3 className="text-base font-bold text-center mb-2 text-foreground">
          {chartData.title}
        </h3>
      )}
      {chartData.subtitle && (
        <p className="text-xs text-muted-foreground text-center mb-3">
          {chartData.subtitle}
        </p>
      )}
      {renderChart()}
    </div>
  );
}

// Bar Chart Renderer (IELTS-style: vertical bars with percentage Y-axis and grid lines)
function BarChartRenderer({ 
  data, 
  getColor,
}: { 
  data: IELTSChartData; 
  getColor: (index: number, color?: string) => string;
}) {
  const items = (data.data || []).filter(d => d?.label && typeof d.value === 'number');
  if (items.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm">
        Bar chart data not available
      </div>
    );
  }

  const maxValue = Math.max(...items.map(d => d.value), 1);
  // Round up to nice tick value
  const niceMax = Math.ceil(maxValue / 10) * 10 || 100;
  const tickCount = 5;
  const tickStep = niceMax / tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => i * tickStep);

  const W = 600;
  const H = 380;
  const pad = { left: 55, right: 20, top: 30, bottom: 70 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const barWidth = Math.min(60, (innerW / items.length) * 0.65);
  const barGap = (innerW - barWidth * items.length) / (items.length + 1);

  const xAt = (i: number) => pad.left + barGap + i * (barWidth + barGap) + barWidth / 2;
  const yAt = (v: number) => pad.top + (1 - v / niceMax) * innerH;

  return (
    <div className="w-full">
      {data.yAxisLabel && (
        <div className="text-xs text-muted-foreground text-center mb-1">{data.yAxisLabel}</div>
      )}

      <svg
        className="w-full h-auto"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={data.title || 'Bar chart'}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Horizontal grid lines */}
        {ticks.map((v, idx) => {
          const y = yAt(v);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                y1={y}
                x2={W - pad.right}
                y2={y}
                stroke="#333"
                strokeWidth={0.8}
              />
              <text
                x={pad.left - 10}
                y={y + 4}
                textAnchor="end"
                fontSize={12}
                fill="#333"
              >
                {v}%
              </text>
            </g>
          );
        })}

        {/* Y-axis */}
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={H - pad.bottom}
          stroke="#333"
          strokeWidth={1.5}
        />
        {/* X-axis */}
        <line
          x1={pad.left}
          y1={H - pad.bottom}
          x2={W - pad.right}
          y2={H - pad.bottom}
          stroke="#333"
          strokeWidth={1.5}
        />

        {/* Bars */}
        {items.map((item, idx) => {
          const x = xAt(idx);
          const barH = (item.value / niceMax) * innerH;
          const y = H - pad.bottom - barH;
          return (
            <g key={idx}>
              <rect
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={barH}
                fill={getColor(idx, item.color)}
              />
            </g>
          );
        })}

        {/* X-axis labels */}
        {items.map((item, idx) => {
          const x = xAt(idx);
          // Wrap long labels
          const label = item.label;
          const maxLen = 14;
          const lines = label.length > maxLen 
            ? [label.slice(0, maxLen), label.slice(maxLen, maxLen * 2)]
            : [label];
          
          return (
            <g key={idx}>
              {lines.map((line, lineIdx) => (
                <text
                  key={lineIdx}
                  x={x}
                  y={H - pad.bottom + 18 + lineIdx * 14}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#333"
                >
                  {line.length > maxLen ? line.slice(0, maxLen - 1) + '…' : line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>

      {data.xAxisLabel && (
        <div className="text-xs text-muted-foreground text-center mt-1">{data.xAxisLabel}</div>
      )}
    </div>
  );
}


// Line Graph Renderer (IELTS-style: thick lines, distinct colors, percentage Y-axis, grid lines)
function LineGraphRenderer({
  data,
  getColor,
}: {
  data: IELTSChartData;
  getColor: (index: number, color?: string) => string;
}) {
  const series = (data.series || []).filter((s) => Array.isArray(s.data) && s.data.length > 0);

  if (series.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm">
        Line graph data not available
      </div>
    );
  }

  const allPoints = series.flatMap((s) => s.data);
  const allY = allPoints.map((p) => p.y);
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  
  // Round to nice tick values (0, 10, 20... or 0, 20, 40...)
  const rawMin = Math.floor(minY / 10) * 10;
  const rawMax = Math.ceil(maxY / 10) * 10;
  const yMin = Math.max(0, rawMin - 10);
  const yMax = rawMax + 10;
  const yRange = yMax - yMin || 1;

  // Use x labels from the longest series
  const xLabels = [...series]
    .sort((a, b) => (b.data?.length || 0) - (a.data?.length || 0))[0]
    ?.data.map((d) => String(d.x)) ?? [];

  const W = 650;
  const H = 380;
  const pad = { left: 60, right: 140, top: 30, bottom: 50 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const xCount = Math.max(2, xLabels.length);
  const xStep = xCount > 1 ? innerW / (xCount - 1) : innerW;

  const xAt = (i: number) => pad.left + i * xStep;
  const yAt = (y: number) => pad.top + (1 - (y - yMin) / yRange) * innerH;

  // Y-axis ticks: 0%, 10%, 20%... up to max
  const tickStep = yRange <= 50 ? 10 : 20;
  const tickValues: number[] = [];
  for (let v = yMin; v <= yMax; v += tickStep) {
    tickValues.push(v);
  }

  return (
    <div className="w-full">
      {data.yAxisLabel && (
        <div className="text-xs text-muted-foreground text-center mb-1">
          {data.yAxisLabel}
        </div>
      )}

      <svg
        className="w-full h-auto"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={data.title || 'Line graph'}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Horizontal grid lines + Y-axis labels */}
        {tickValues.map((v, idx) => {
          const y = yAt(v);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                y1={y}
                x2={W - pad.right}
                y2={y}
                stroke="#333"
                strokeWidth={0.8}
              />
              <text
                x={pad.left - 12}
                y={y + 4}
                textAnchor="end"
                fontSize={12}
                fill="#333"
              >
                {v}%
              </text>
            </g>
          );
        })}

        {/* Vertical grid lines at each X point */}
        {xLabels.map((_, i) => {
          const x = xAt(i);
          return (
            <line
              key={i}
              x1={x}
              y1={pad.top}
              x2={x}
              y2={H - pad.bottom}
              stroke="#aaa"
              strokeWidth={0.5}
            />
          );
        })}

        {/* Axes */}
        <line
          x1={pad.left}
          y1={pad.top}
          x2={pad.left}
          y2={H - pad.bottom}
          stroke="#333"
          strokeWidth={1.5}
        />
        <line
          x1={pad.left}
          y1={H - pad.bottom}
          x2={W - pad.right}
          y2={H - pad.bottom}
          stroke="#333"
          strokeWidth={1.5}
        />

        {/* X labels */}
        {xLabels.map((label, i) => {
          const x = xAt(i);
          const y = H - pad.bottom + 22;
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize={12}
              fontWeight={500}
              fill="#333"
            >
              {label}
            </text>
          );
        })}

        {/* Series - thick lines with distinct colors */}
        {series.map((s, sIdx) => {
          const color = getColor(sIdx, s.color);
          const pts = s.data
            .map((p, i) => {
              const xi = xLabels.findIndex((x) => String(x) === String(p.x));
              const xIndex = xi >= 0 ? xi : i;
              return { x: xAt(xIndex), y: yAt(p.y), raw: p };
            })
            .sort((a, b) => a.x - b.x);

          const d = pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
            .join(' ');

          return (
            <g key={sIdx}>
              <path d={d} fill="none" stroke={color} strokeWidth={3} />
              {pts.map((p, idx) => (
                <circle
                  key={idx}
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  <title>{`${s.name}: ${p.raw.y}%`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {/* Legend - on right side like official IELTS */}
        {series.length > 0 && (
          <g>
            {series.map((s, idx) => {
              const y = pad.top + 40 + idx * 28;
              const color = getColor(idx, s.color);
              return (
                <g key={idx}>
                  <line
                    x1={W - pad.right + 20}
                    y1={y}
                    x2={W - pad.right + 45}
                    y2={y}
                    stroke={color}
                    strokeWidth={3}
                  />
                  <text
                    x={W - pad.right + 50}
                    y={y + 4}
                    fontSize={12}
                    fontWeight={500}
                    fill={color}
                  >
                    {s.name}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {data.xAxisLabel && (
        <div className="text-xs text-muted-foreground text-center mt-1">{data.xAxisLabel}</div>
      )}
    </div>
  );
}

// Pie Chart Renderer (with percentage labels inside slices like IELTS)
function PieChartRenderer({
  data,
  getColor,
}: {
  data: IELTSChartData;
  getColor: (index: number, color?: string) => string;
}) {
  const items = (data.data || []).filter((d) => d?.label && typeof d.value === 'number');
  if (items.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm">
        Pie chart data not available
      </div>
    );
  }
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;

  // Calculate segment angles
  let currentAngle = -90; // start at 12 o'clock
  const segments = items.map((item, idx) => {
    const percentage = (item.value / total) * 100;
    const angle = (item.value / total) * 360;
    const segment = {
      ...item,
      percentage,
      startAngle: currentAngle,
      midAngle: currentAngle + angle / 2,
      endAngle: currentAngle + angle,
      color: getColor(idx, item.color),
    };
    currentAngle += angle;
    return segment;
  });

  const R = 100; // outer radius
  const cx = 120;
  const cy = 120;

  // Arc path helper
  const arc = (start: number, end: number, r: number) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const x1 = cx + r * Math.cos(toRad(start));
    const y1 = cy + r * Math.sin(toRad(start));
    const x2 = cx + r * Math.cos(toRad(end));
    const y2 = cy + r * Math.sin(toRad(end));
    const largeArc = end - start > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  };

  const labelPos = (angle: number, dist: number) => {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + dist * Math.cos(rad), y: cy + dist * Math.sin(rad) };
  };

  return (
    <div className="flex flex-col items-center w-full">
      {data.title && (
        <h4 className="text-sm font-semibold text-center mb-3 text-foreground">{data.title}</h4>
      )}
      
      {/* SVG pie */}
      <svg
        viewBox="0 0 240 240"
        className="w-56 h-56"
        role="img"
        aria-label={data.title || 'Pie chart'}
      >
        {segments.map((s, idx) => (
          <g key={idx}>
            <path d={arc(s.startAngle, s.endAngle, R)} fill={s.color} />
            {/* Label if slice is big enough */}
            {s.percentage >= 6 && (() => {
              const pos = labelPos(s.midAngle, R * 0.65);
              return (
                <text
                  x={pos.x}
                  y={pos.y + 4}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill="#fff"
                >
                  {s.percentage.toFixed(0)}%
                </text>
              );
            })()}
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4">
        {segments.map((segment, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <div
              className="w-4 h-4 rounded-sm flex-shrink-0"
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-foreground">
              {segment.label}: {segment.percentage.toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Table Renderer - IELTS style with colored header row and first column
function TableRenderer({ data }: { data: IELTSChartData }) {
  const headers = data.headers || [];
  const rows = data.rows || [];

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm border-collapse border border-border">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((header, idx) => (
                <th 
                  key={idx}
                  className="bg-slate-200 dark:bg-slate-700 border border-border px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td 
                  key={cellIdx}
                  className={cn(
                    'border border-border px-3 py-2 whitespace-nowrap',
                    cellIdx === 0 
                      ? 'bg-slate-100 dark:bg-slate-800 font-medium' 
                      : 'bg-background',
                    cell.isHeader && 'bg-slate-100 dark:bg-slate-800 font-medium'
                  )}
                >
                  {cell.value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Process Diagram Renderer - IELTS-style horizontal flow chart with arrows
function ProcessDiagramRenderer({ data }: { data: IELTSChartData }) {
  const steps = (data.steps || []).filter((s) => s?.label);

  if (steps.length === 0) {
    return (
      <div className="text-center text-muted-foreground text-sm">
        Process diagram data not available
      </div>
    );
  }

  // For process diagrams, use a horizontal flow layout like real IELTS
  // with boxes connected by arrows
  const W = 800;
  const boxH = 60;
  const boxW = 140;
  const arrowW = 40;
  const rowGap = 80;
  
  // Calculate how many boxes fit per row
  const boxesPerRow = Math.min(4, steps.length);
  const rowCount = Math.ceil(steps.length / boxesPerRow);
  const H = rowCount * (boxH + rowGap) + 60;
  
  const getBoxPosition = (idx: number) => {
    const row = Math.floor(idx / boxesPerRow);
    const col = idx % boxesPerRow;
    // Alternate direction for snake pattern
    const actualCol = row % 2 === 0 ? col : (boxesPerRow - 1 - col);
    const x = 50 + actualCol * (boxW + arrowW);
    const y = 40 + row * (boxH + rowGap);
    return { x, y, row, col: actualCol };
  };

  return (
    <div className="w-full">
      <svg
        className="w-full h-auto"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={data.title || 'Process diagram'}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="process-arrow"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L0,10 L10,5 z" fill="#666" />
          </marker>
        </defs>

        {steps.map((step, idx) => {
          const pos = getBoxPosition(idx);
          const nextPos = idx < steps.length - 1 ? getBoxPosition(idx + 1) : null;

          return (
            <g key={idx}>
              {/* Box */}
              <rect
                x={pos.x}
                y={pos.y}
                width={boxW}
                height={boxH}
                rx={8}
                fill="#f8f9fa"
                stroke="#333"
                strokeWidth={2}
              />
              
              {/* Step number circle */}
              <circle
                cx={pos.x + 20}
                cy={pos.y + boxH / 2}
                r={14}
                fill="#3366CC"
              />
              <text
                x={pos.x + 20}
                y={pos.y + boxH / 2 + 5}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                fill="#fff"
              >
                {idx + 1}
              </text>

              {/* Step label - wrap text */}
              <foreignObject
                x={pos.x + 38}
                y={pos.y + 8}
                width={boxW - 48}
                height={boxH - 16}
              >
                <div 
                  style={{ 
                    fontSize: '11px', 
                    lineHeight: '1.2',
                    color: '#333',
                    display: 'flex',
                    alignItems: 'center',
                    height: '100%',
                    fontWeight: 500,
                  }}
                >
                  {step.label}
                </div>
              </foreignObject>

              {/* Arrow to next step */}
              {nextPos && (
                <>
                  {pos.row === nextPos.row ? (
                    // Horizontal arrow (same row)
                    <line
                      x1={pos.x + boxW + 4}
                      y1={pos.y + boxH / 2}
                      x2={nextPos.x - 4}
                      y2={nextPos.y + boxH / 2}
                      stroke="#666"
                      strokeWidth={2}
                      markerEnd="url(#process-arrow)"
                    />
                  ) : (
                    // Vertical arrow (different row) + connecting path
                    <path
                      d={`M ${pos.x + boxW / 2} ${pos.y + boxH + 4} 
                          L ${pos.x + boxW / 2} ${nextPos.y - 20}
                          L ${nextPos.x + boxW / 2} ${nextPos.y - 20}
                          L ${nextPos.x + boxW / 2} ${nextPos.y - 4}`}
                      fill="none"
                      stroke="#666"
                      strokeWidth={2}
                      markerEnd="url(#process-arrow)"
                    />
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Step descriptions below if any */}
      {steps.some(s => s.description) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
          {steps.filter(s => s.description).map((step, idx) => (
            <div key={idx} className="bg-muted/20 border border-border rounded px-3 py-2">
              <div className="flex items-start gap-2">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded mt-0.5">
                  {steps.indexOf(step) + 1}
                </span>
                <div>
                  <span className="text-sm font-medium text-foreground">{step.label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Map Renderer - IELTS-style side-by-side comparison with visual elements
function MapRenderer({ data }: { data: IELTSChartData }) {
  const mapData = data.mapData;
  
  if (!mapData) {
    return <div className="text-center text-muted-foreground text-sm">Map data not available</div>;
  }

  const getFeatureColor = (type: string) => {
    switch (type) {
      case 'building': return '#D97706'; // amber
      case 'road': return '#64748B'; // slate
      case 'park': return '#16A34A'; // green
      case 'water': return '#2563EB'; // blue
      default: return '#9CA3AF'; // gray
    }
  };

  const renderMapPanel = (features: MapFeature[], year: string) => {
    // Create a simplified visual map representation
    const W = 280;
    const H = 300;
    
    return (
      <div className="flex-1">
        <div className="text-sm font-bold text-center mb-2 bg-slate-200 dark:bg-slate-700 py-2 rounded-t">
          {year}
        </div>
        <div className="border border-border rounded-b bg-slate-50 dark:bg-slate-900 p-3">
          {/* Visual map representation */}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto mb-3"
            style={{ minHeight: 180 }}
          >
            {/* Background grid pattern for map effect */}
            <defs>
              <pattern id="map-grid" patternUnits="userSpaceOnUse" width="20" height="20">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e5e7eb" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width={W} height={H} fill="url(#map-grid)" />
            
            {/* Compass rose */}
            <g transform="translate(240, 30)">
              <circle r="18" fill="#fff" stroke="#333" strokeWidth="1" />
              <text textAnchor="middle" y="-4" fontSize="10" fontWeight="bold" fill="#333">N</text>
              <text textAnchor="middle" y="12" fontSize="8" fill="#666">S</text>
              <text textAnchor="end" x="-6" y="4" fontSize="8" fill="#666">W</text>
              <text textAnchor="start" x="6" y="4" fontSize="8" fill="#666">E</text>
              <line x1="0" y1="-14" x2="0" y2="-8" stroke="#333" strokeWidth="2" />
            </g>

            {/* Position features on the map */}
            {features.map((feature, idx) => {
              // Calculate position based on index - spread across map
              const row = Math.floor(idx / 3);
              const col = idx % 3;
              const x = 40 + col * 80;
              const y = 60 + row * 70;
              const color = getFeatureColor(feature.type);

              return (
                <g key={idx} transform={`translate(${x}, ${y})`}>
                  {/* Feature shape based on type */}
                  {feature.type === 'building' && (
                    <rect x="-15" y="-15" width="30" height="30" fill={color} rx="2" />
                  )}
                  {feature.type === 'road' && (
                    <rect x="-20" y="-5" width="40" height="10" fill={color} rx="1" />
                  )}
                  {feature.type === 'park' && (
                    <circle r="18" fill={color} opacity="0.7" />
                  )}
                  {feature.type === 'water' && (
                    <ellipse rx="22" ry="14" fill={color} opacity="0.6" />
                  )}
                  {feature.type === 'other' && (
                    <circle r="12" fill={color} />
                  )}
                  
                  {/* Label */}
                  <text
                    y={feature.type === 'road' ? 20 : 30}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="500"
                    fill="#333"
                  >
                    {feature.label.length > 12 ? feature.label.slice(0, 11) + '…' : feature.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Legend */}
          <div className="border-t border-border pt-2 mt-2">
            <div className="text-xs font-semibold mb-1">KEY</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {['building', 'road', 'park', 'water'].map(type => {
                const hasType = features.some(f => f.type === type);
                if (!hasType) return null;
                return (
                  <div key={type} className="flex items-center gap-1 text-xs">
                    <div 
                      className="w-3 h-3 rounded-sm" 
                      style={{ backgroundColor: getFeatureColor(type) }}
                    />
                    <span className="capitalize">{type}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Side-by-side comparison if before/after exists
  if (mapData.before && mapData.after) {
    return (
      <div className="w-full">
        <div className="flex gap-4">
          {renderMapPanel(mapData.before.features, mapData.before.year)}
          {renderMapPanel(mapData.after.features, mapData.after.year)}
        </div>
      </div>
    );
  }

  // Single map
  if (mapData.features) {
    return (
      <div className="w-full max-w-md mx-auto">
        {renderMapPanel(mapData.features, 'Location Map')}
      </div>
    );
  }

  return <div className="text-center text-muted-foreground text-sm">Map configuration not recognized</div>;
}

// Mixed Charts Renderer (IELTS-style: stacked vertically with proper spacing)
function MixedChartsRenderer({
  data,
  getColor,
}: {
  data: IELTSChartData;
  getColor: (index: number, color?: string) => string;
}) {
  const charts = data.charts || [];

  if (charts.length === 0) {
    return <div className="text-center text-muted-foreground text-sm">No charts to display</div>;
  }

  return (
    <div className="flex flex-col gap-8 w-full">
      {charts.map((chart, idx) => (
        <div key={idx} className="w-full">
          {chart.title && (
            <h4 className="text-sm font-bold text-center mb-3 text-foreground">{chart.title}</h4>
          )}
          {chart.type === 'BAR_CHART' && <BarChartRenderer data={chart} getColor={getColor} />}
          {chart.type === 'LINE_GRAPH' && <LineGraphRenderer data={chart} getColor={getColor} />}
          {chart.type === 'PIE_CHART' && <PieChartRenderer data={chart} getColor={getColor} />}
          {chart.type === 'TABLE' && <TableRenderer data={chart} />}
        </div>
      ))}
    </div>
  );
}

export default IELTSVisualRenderer;
