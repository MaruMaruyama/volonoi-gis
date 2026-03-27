import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  useMapEvents,
  CircleMarker,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { Delaunay } from 'd3-delaunay';
import './App.css';

interface GeoPoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

interface VoronoiSettings {
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  pointColor: string;
  pointRadius: number;
  showPoints: boolean;
  showVoronoi: boolean;
  showDelaunay: boolean;
  colorScheme: string;
}

const COLOR_SCHEMES: Record<string, string[]> = {
  pastel: [
    '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF',
    '#E8BAFF', '#FFB3E6', '#B3FFE6', '#FFE6B3', '#B3D9FF',
    '#D9B3FF', '#B3FFB3', '#FFB3B3', '#B3FFFF', '#FFFFB3',
  ],
  vivid: [
    '#FF6B6B', '#FFA07A', '#FFD700', '#98FB98', '#87CEEB',
    '#DDA0DD', '#FF69B4', '#00CED1', '#FF8C00', '#7B68EE',
    '#3CB371', '#DC143C', '#00BFFF', '#FF1493', '#32CD32',
  ],
  earth: [
    '#8B7355', '#A0826D', '#C4A882', '#D2B48C', '#DEB887',
    '#8FBC8F', '#6B8E23', '#556B2F', '#BDB76B', '#DAA520',
    '#CD853F', '#D2691E', '#A0522D', '#8B4513', '#BC8F8F',
  ],
  ocean: [
    '#006994', '#0099DB', '#40B4E5', '#7EC8E3', '#B3DCF2',
    '#004E7C', '#005B96', '#6497B1', '#B3CDE0', '#03396C',
    '#005F73', '#0A9396', '#94D2BD', '#E9D8A6', '#EE9B00',
  ],
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function VoronoiOverlay({
  points,
  settings,
}: {
  points: GeoPoint[];
  settings: VoronoiSettings;
}) {
  const map = useMap();
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (points.length < 2) {
      if (svgRef.current) {
        svgRef.current.innerHTML = '';
      }
      return;
    }

    const pane = map.getPane('overlayPane');
    if (!pane) return;

    if (!svgRef.current) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'voronoi-overlay');
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.pointerEvents = 'none';
      pane.appendChild(svg);
      svgRef.current = svg;
    }

    const updateOverlay = () => {
      const svg = svgRef.current;
      if (!svg) return;

      const bounds = map.getBounds();
      const topLeft = map.latLngToLayerPoint(bounds.getNorthWest());
      const bottomRight = map.latLngToLayerPoint(bounds.getSouthEast());

      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;

      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px)`;

      const pixelPoints = points.map((p) => {
        const pt = map.latLngToLayerPoint(L.latLng(p.lat, p.lng));
        return [pt.x - topLeft.x, pt.y - topLeft.y] as [number, number];
      });

      const delaunay = Delaunay.from(pixelPoints);
      const voronoi = delaunay.voronoi([0, 0, width, height]);

      let pathsHtml = '';
      const colors = COLOR_SCHEMES[settings.colorScheme] || COLOR_SCHEMES.pastel;

      if (settings.showVoronoi) {
        for (let i = 0; i < points.length; i++) {
          const cell = voronoi.cellPolygon(i);
          if (!cell) continue;
          const d = 'M' + cell.map((c: number[]) => c.join(',')).join('L') + 'Z';
          const fillColor = colors[i % colors.length];
          pathsHtml += `<path d="${d}" fill="${fillColor}" fill-opacity="${settings.fillOpacity}" stroke="${settings.strokeColor}" stroke-width="${settings.strokeWidth}" />`;
        }
      }

      if (settings.showDelaunay) {
        const triangles = delaunay.triangles;
        for (let i = 0; i < triangles.length; i += 3) {
          const p0 = pixelPoints[triangles[i]];
          const p1 = pixelPoints[triangles[i + 1]];
          const p2 = pixelPoints[triangles[i + 2]];
          pathsHtml += `<path d="M${p0[0]},${p0[1]}L${p1[0]},${p1[1]}L${p2[0]},${p2[1]}Z" fill="none" stroke="#999" stroke-width="1" stroke-dasharray="4,4" />`;
        }
      }

      svg.innerHTML = pathsHtml;
    };

    updateOverlay();
    map.on('moveend zoomend', updateOverlay);

    return () => {
      map.off('moveend zoomend', updateOverlay);
    };
  }, [map, points, settings]);

  useEffect(() => {
    return () => {
      if (svgRef.current && svgRef.current.parentNode) {
        svgRef.current.parentNode.removeChild(svgRef.current);
        svgRef.current = null;
      }
    };
  }, []);

  return null;
}

function MapClickHandler({
  onMapClick,
}: {
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function DraggablePoint({
  point,
  settings,
  onDragEnd,
  onRemove,
}: {
  point: GeoPoint;
  settings: VoronoiSettings;
  onDragEnd: (id: string, lat: number, lng: number) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <CircleMarker
      center={[point.lat, point.lng]}
      radius={settings.pointRadius}
      pathOptions={{
        color: settings.pointColor,
        fillColor: settings.pointColor,
        fillOpacity: 1,
        weight: 2,
      }}
      eventHandlers={{
        contextmenu: (e) => {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e as unknown as Event);
          onRemove(point.id);
        },
        mousedown: (e) => {
          L.DomEvent.stopPropagation(e);
          const map = e.target._map;
          if (!map) return;

          map.dragging.disable();

          const onMouseMove = (moveEvent: MouseEvent) => {
            const containerPoint = map.mouseEventToContainerPoint(moveEvent);
            const latlng = map.containerPointToLatLng(containerPoint);
            e.target.setLatLng(latlng);
          };

          const onMouseUp = (upEvent: MouseEvent) => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            map.dragging.enable();

            const containerPoint = map.mouseEventToContainerPoint(upEvent);
            const latlng = map.containerPointToLatLng(containerPoint);
            onDragEnd(point.id, latlng.lat, latlng.lng);
          };

          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        },
      }}
    >
      <Popup>
        <div style={{ fontSize: '12px' }}>
          <strong>{point.label || `Point ${point.id.slice(0, 4)}`}</strong>
          <br />
          Lat: {point.lat.toFixed(6)}
          <br />
          Lng: {point.lng.toFixed(6)}
          <br />
          <button
            onClick={() => onRemove(point.id)}
            style={{
              marginTop: '4px',
              color: 'red',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
              fontSize: '12px',
            }}
          >
            Remove
          </button>
        </div>
      </Popup>
    </CircleMarker>
  );
}

function App() {
  const [points, setPoints] = useState<GeoPoint[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [settings, setSettings] = useState<VoronoiSettings>({
    fillOpacity: 0.35,
    strokeColor: '#333333',
    strokeWidth: 2,
    pointColor: '#3b82f6',
    pointRadius: 6,
    showPoints: true,
    showVoronoi: true,
    showDelaunay: false,
    colorScheme: 'pastel',
  });

  const addPoint = useCallback((lat: number, lng: number) => {
    setPoints((prev) => [
      ...prev,
      { id: generateId(), lat, lng },
    ]);
  }, []);

  const removePoint = useCallback((id: string) => {
    setPoints((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const movePoint = useCallback((id: string, lat: number, lng: number) => {
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, lat, lng } : p))
    );
  }, []);

  const clearAll = useCallback(() => {
    setPoints([]);
  }, []);

  const generateRandom = useCallback(
    (count: number) => {
      const newPoints: GeoPoint[] = [];
      for (let i = 0; i < count; i++) {
        newPoints.push({
          id: generateId(),
          lat: 35.6 + (Math.random() - 0.5) * 0.2,
          lng: 139.7 + (Math.random() - 0.5) * 0.3,
        });
      }
      setPoints((prev) => [...prev, ...newPoints]);
    },
    []
  );

  const exportGeoJSON = useCallback(() => {
    const geojson = {
      type: 'FeatureCollection' as const,
      features: points.map((p) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.lng, p.lat],
        },
        properties: {
          id: p.id,
          label: p.label || `Point ${p.id.slice(0, 4)}`,
        },
      })),
    };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'voronoi-points.geojson';
    a.click();
    URL.revokeObjectURL(url);
  }, [points]);

  const importGeoJSON = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.geojson,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
            const imported: GeoPoint[] = data.features
              .filter(
                (f: { geometry?: { type?: string; coordinates?: number[] } }) =>
                  f.geometry?.type === 'Point' && f.geometry?.coordinates
              )
              .map(
                (f: {
                  geometry: { coordinates: number[] };
                  properties?: { id?: string; label?: string; name?: string };
                }) => ({
                  id: f.properties?.id || generateId(),
                  lat: f.geometry.coordinates[1],
                  lng: f.geometry.coordinates[0],
                  label: f.properties?.label || f.properties?.name,
                })
              );
            setPoints((prev) => [...prev, ...imported]);
          }
        } catch {
          alert('Invalid GeoJSON file');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const updateSetting = useCallback(
    <K extends keyof VoronoiSettings>(key: K, value: VoronoiSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const showInstructions = points.length === 0;

  const pointCount = useMemo(() => points.length, [points]);

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <MapContainer
        center={[35.6812, 139.7671]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler onMapClick={addPoint} />
        <VoronoiOverlay points={points} settings={settings} />
        {settings.showPoints &&
          points.map((point) => (
            <DraggablePoint
              key={point.id}
              point={point}
              settings={settings}
              onDragEnd={movePoint}
              onRemove={removePoint}
            />
          ))}
      </MapContainer>

      {showInstructions && (
        <div className="instructions-overlay">
          <h2>Voronoi GIS Tool</h2>
          <p>Click on the map to add points</p>
          <p>Drag points to move them</p>
          <p>Right-click a point to remove it</p>
          <p style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af' }}>
            Voronoi diagram appears after 2+ points
          </p>
        </div>
      )}

      {panelOpen ? (
        <div className="control-panel">
          <div
            className="control-panel-header"
            onClick={() => setPanelOpen(false)}
          >
            <span style={{ fontWeight: 600, fontSize: '14px' }}>
              Controls
            </span>
            <span style={{ fontSize: '18px' }}>&#x2715;</span>
          </div>
          <div className="control-panel-body">
            <div className="control-section">
              <h4>Actions</h4>
              <div className="btn-group">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => generateRandom(10)}
                >
                  + 10 Random
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={importGeoJSON}
                >
                  Import
                </button>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={exportGeoJSON}
                  disabled={points.length === 0}
                >
                  Export
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={clearAll}
                  disabled={points.length === 0}
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="control-section">
              <h4>Display</h4>
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="showVoronoi"
                  checked={settings.showVoronoi}
                  onChange={(e) =>
                    updateSetting('showVoronoi', e.target.checked)
                  }
                />
                <label htmlFor="showVoronoi">Show Voronoi</label>
              </div>
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="showDelaunay"
                  checked={settings.showDelaunay}
                  onChange={(e) =>
                    updateSetting('showDelaunay', e.target.checked)
                  }
                />
                <label htmlFor="showDelaunay">Show Delaunay</label>
              </div>
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="showPoints"
                  checked={settings.showPoints}
                  onChange={(e) =>
                    updateSetting('showPoints', e.target.checked)
                  }
                />
                <label htmlFor="showPoints">Show Points</label>
              </div>
            </div>

            <div className="control-section">
              <h4>Style</h4>
              <div className="control-row">
                <label>Color Scheme</label>
                <select
                  value={settings.colorScheme}
                  onChange={(e) =>
                    updateSetting('colorScheme', e.target.value)
                  }
                >
                  <option value="pastel">Pastel</option>
                  <option value="vivid">Vivid</option>
                  <option value="earth">Earth</option>
                  <option value="ocean">Ocean</option>
                </select>
              </div>
              <div className="control-row">
                <label>Fill Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.fillOpacity}
                  onChange={(e) =>
                    updateSetting('fillOpacity', parseFloat(e.target.value))
                  }
                />
              </div>
              <div className="control-row">
                <label>Stroke Color</label>
                <input
                  type="color"
                  value={settings.strokeColor}
                  onChange={(e) =>
                    updateSetting('strokeColor', e.target.value)
                  }
                />
              </div>
              <div className="control-row">
                <label>Stroke Width</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.5"
                  value={settings.strokeWidth}
                  onChange={(e) =>
                    updateSetting('strokeWidth', parseFloat(e.target.value))
                  }
                />
              </div>
              <div className="control-row">
                <label>Point Color</label>
                <input
                  type="color"
                  value={settings.pointColor}
                  onChange={(e) =>
                    updateSetting('pointColor', e.target.value)
                  }
                />
              </div>
              <div className="control-row">
                <label>Point Size</label>
                <input
                  type="number"
                  min="2"
                  max="20"
                  value={settings.pointRadius}
                  onChange={(e) =>
                    updateSetting('pointRadius', parseInt(e.target.value))
                  }
                />
              </div>
            </div>

            {points.length > 0 && (
              <div className="control-section">
                <h4>Points ({points.length})</h4>
                <div className="point-list">
                  {points.map((p, i) => (
                    <div key={p.id} className="point-item">
                      <span>
                        #{i + 1} ({p.lat.toFixed(4)}, {p.lng.toFixed(4)})
                      </span>
                      <button onClick={() => removePoint(p.id)} title="Remove">
                        &#x2715;
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <button className="toggle-btn" onClick={() => setPanelOpen(true)}>
          &#x2699;
        </button>
      )}

      <div className="stats-bar">
        <span>Points: {pointCount}</span>
        <span>
          Cells: {pointCount >= 2 ? pointCount : 0}
        </span>
        <span>
          Zoom: use scroll
        </span>
      </div>
    </div>
  );
}

export default App;
