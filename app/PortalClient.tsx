"use client";

import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type PointRecord = {
  id: number;
  municipio: string;
  year: number;
  code: string;
  area: number;
  x: number;
  y: number;
  density: number;
  densityClass: string;
  parcelId: number;
  parcelArea: number;
  parcelClass: string;
  principal: number;
  secondary: number;
  cover: string[];
};

type PortalDataset = {
  years: number[];
  classes: string[];
  points: PointRecord[];
};

type Filters = {
  municipio: string;
  densityClass: string;
  parcelClass: string;
  densityMin: string;
  densityMax: string;
  principalMaxKm: string;
  secondaryMaxKm: string;
  yearMin: string;
  yearMax: string;
  search: string;
};

type CoverageSelection =
  | {
      kind: "node";
      year: number;
      cover: string;
    }
  | {
      kind: "transition";
      sourceYear: number;
      sourceCover: string;
      targetYear: number;
      targetCover: string;
    }
  | null;

type MapSymbolMode = "coverage" | "density" | "parcel" | "selection";

const initialFilters: Filters = {
  municipio: "",
  densityClass: "",
  parcelClass: "",
  densityMin: "",
  densityMax: "",
  principalMaxKm: "",
  secondaryMaxKm: "",
  yearMin: "",
  yearMax: "",
  search: "",
};

const COVER_COLORS: Record<string, string> = {
  Arbustal: "#8a5a2b",
  Bosque: "#167c45",
  Cultivo: "#e2b93b",
  Estanques: "#2f8ee5",
  Humedal: "#167c8c",
  Pastizal: "#9bdc4c",
};

const DENSITY_COLORS: Record<string, string> = {
  Baja: "#f2c94c",
  Media: "#f2994a",
  Alta: "#d64545",
};

const SANKEY_YEARS = [2010, 2015, 2020, 2025];

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function getDetectionYear(point: PointRecord, years: number[]) {
  const firstPondIndex = point.cover.findIndex((cover) => cover === "Estanques");
  return firstPondIndex >= 0 ? years[firstPondIndex] : null;
}

function downloadChart(chart: echarts.ECharts | null, filename: string) {
  if (!chart) return;
  const link = document.createElement("a");
  link.download = `${filename}.jpg`;
  link.href = chart.getDataURL({
    type: "jpeg",
    pixelRatio: 2,
    backgroundColor: "#ffffff",
  });
  link.click();
}

function useChart(
  option: EChartsOption | null,
  onClick?: (params: Record<string, unknown>) => void,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, undefined, {
      renderer: "canvas",
    });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (option && chartRef.current) {
      chartRef.current.setOption(option, { notMerge: true });
    }
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onClick) return;
    const handler = (params: Record<string, unknown>) => onClick(params);
    chart.on("click", handler);
    return () => chart.off("click", handler);
  }, [onClick]);

  return { containerRef, chartRef };
}

function ChartCard({
  title,
  subtitle,
  option,
  fullscreenOption,
  filename,
  onChartClick,
}: {
  title: string;
  subtitle: string;
  option: EChartsOption | null;
  fullscreenOption?: EChartsOption | null;
  filename: string;
  onChartClick?: (params: Record<string, unknown>) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const displayedOption =
    fullscreen && fullscreenOption ? fullscreenOption : option;
  const { containerRef, chartRef } = useChart(displayedOption, onChartClick);

  useEffect(() => {
    const timeout = window.setTimeout(() => chartRef.current?.resize(), 90);
    return () => window.clearTimeout(timeout);
  }, [fullscreen, chartRef]);

  return (
    <article className={`chart-card ${fullscreen ? "chart-fullscreen" : ""}`}>
      <div className="card-heading">
        <div>
          <span className="eyebrow">Análisis dinámico</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="chart-actions">
          <button
            className="icon-button"
            onClick={() => setFullscreen((value) => !value)}
            aria-label={
              fullscreen ? "Cerrar pantalla completa" : "Ver en pantalla completa"
            }
            title={
              fullscreen ? "Cerrar pantalla completa" : "Pantalla completa"
            }
          >
            {fullscreen ? "×" : "⛶"}
          </button>
          <button
            className="icon-button"
            onClick={() => downloadChart(chartRef.current, filename)}
            aria-label={`Exportar ${title} como JPG`}
            title="Exportar JPG"
          >
            JPG
          </button>
        </div>
      </div>
      <div className="chart-canvas" ref={containerRef} />
    </article>
  );
}

function PortalMap({
  points,
  selectablePoints,
  allCount,
  years,
  symbolMode,
  selection,
  spatialSelectionCount,
  onOpenFilters,
  onSpatialSelect,
  onClearSpatialSelection,
}: {
  points: PointRecord[];
  selectablePoints: PointRecord[];
  allCount: number;
  years: number[];
  symbolMode: MapSymbolMode;
  selection: CoverageSelection;
  spatialSelectionCount: number | null;
  onOpenFilters: () => void;
  onSpatialSelect: (pointIds: number[]) => void;
  onClearSpatialSelection: () => void;
}) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LayerGroup | null>(null);
  const drawnItemsRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const selectablePointsRef = useRef(selectablePoints);
  const onSpatialSelectRef = useRef(onSpatialSelect);
  const firstDraw = useRef(true);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    selectablePointsRef.current = selectablePoints;
    onSpatialSelectRef.current = onSpatialSelect;
  }, [onSpatialSelect, selectablePoints]);

  useEffect(() => {
    if (spatialSelectionCount === null) {
      drawnItemsRef.current?.clearLayers();
    }
  }, [spatialSelectionCount]);

  useEffect(() => {
    let cancelled = false;
    async function initializeMap() {
      if (!mapElement.current || mapRef.current) return;
      const leafletModule = await import("leaflet");
      const L = (leafletModule.default ??
        leafletModule) as typeof import("leaflet");
      if (cancelled || !mapElement.current) return;
      leafletRef.current = L;
      const map = L.map(mapElement.current, {
        zoomControl: false,
        preferCanvas: true,
      }).setView([-17.22, -64.55], 7);
      map.createPane("kernelDensityPane").style.zIndex = "350";
      map.createPane("municipalBoundaryPane").style.zIndex = "400";
      map.createPane("roadNetworkPane").style.zIndex = "410";
      map.createPane("totalPondsPane").style.zIndex = "430";
      map.createPane("samplePondsPane").style.zIndex = "450";
      const satellite = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Imágenes © Esri",
          maxZoom: 19,
        },
      );
      const streets = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution: "© OpenStreetMap",
          maxZoom: 19,
        },
      );
      satellite.addTo(map);

      const pondRenderer = L.canvas({ padding: 0.5 });
      const kernelLayer = L.geoJSON(undefined, {
        pane: "kernelDensityPane",
        style: (feature) => {
          const densityClass = String(feature?.properties?.CLASE ?? "");
          const color =
            densityClass === "Alta"
              ? "#e31a1c"
              : densityClass === "Media"
                ? "#feb24c"
                : "#ffffb2";
          return {
            color,
            weight: 0.6,
            fillColor: color,
            fillOpacity: densityClass === "Alta" ? 0.42 : 0.34,
          };
        },
        onEachFeature: (feature, layer) => {
          const densityClass = String(feature.properties?.CLASE ?? "");
          const classValue = String(feature.properties?.gridcode ?? "");
          layer.bindTooltip(
            `Densidad ${densityClass} · Clase ${classValue}`,
            { sticky: true },
          );
        },
      });
      const principalRoadsLayer = L.geoJSON(undefined, {
        pane: "roadNetworkPane",
        style: {
          color: "#cdaa7d",
          weight: 2,
          opacity: 1,
        },
      });
      const municipalBoundariesLayer = L.geoJSON(undefined, {
        pane: "municipalBoundaryPane",
        style: {
          color: "#ffffff",
          weight: 1.5,
          opacity: 1,
          fill: false,
          fillOpacity: 0,
        },
        onEachFeature: (feature, layer) => {
          const municipality = String(
            feature.properties?.MUNICIPIO ?? "",
          ).trim();
          if (municipality) layer.bindTooltip(municipality, { sticky: true });
        },
      });
      const secondaryRoadsLayer = L.geoJSON(undefined, {
        pane: "roadNetworkPane",
        style: {
          color: "#e1e1e1",
          weight: 1,
          opacity: 1,
        },
        onEachFeature: (feature, layer) => {
          const name = String(feature.properties?.nombr ?? "").trim();
          if (name && name !== "Desconocido") layer.bindTooltip(name);
        },
      });
      const allPondsLayer = L.geoJSON(undefined, {
        pane: "totalPondsPane",
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, {
            pane: "totalPondsPane",
            renderer: pondRenderer,
            radius: 2.4,
            weight: 0.7,
            color: "#000000",
            fillColor: "#00c5ff",
            fillOpacity: 0.88,
          }).bindTooltip(
            [
              feature.properties?.MUNICIPIO,
              feature.properties?.YEAR
                ? `Año ${feature.properties.YEAR}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
            { sticky: true },
          ),
      });

      kernelLayer.addTo(map);
      municipalBoundariesLayer.addTo(map);
      principalRoadsLayer.addTo(map);
      secondaryRoadsLayer.addTo(map);
      allPondsLayer.addTo(map);

      L.control
        .layers(
          {
            "Satélite Esri": satellite,
            "Calles OpenStreetMap": streets,
          },
          {
            "Densidad Kernel 10 km": kernelLayer,
            "Límites municipales": municipalBoundariesLayer,
            "Carreteras principales": principalRoadsLayer,
            "Carreteras secundarias": secondaryRoadsLayer,
            "Estanques piscícolas (todos)": allPondsLayer,
          },
          { position: "topright" },
        )
        .addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      markersRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);

      const loadGeoJson = async (
        url: string,
        layer: ReturnType<typeof L.geoJSON>,
      ) => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`No se pudo cargar la capa ${url}`);
        }
        layer.addData((await response.json()) as never);
      };

      Promise.all([
        loadGeoJson("data/layers/densidad_kernel_10km.geojson", kernelLayer),
        loadGeoJson(
          "data/layers/limites_municipales.geojson",
          municipalBoundariesLayer,
        ),
        loadGeoJson(
          "data/layers/carreteras_principales.geojson",
          principalRoadsLayer,
        ),
        loadGeoJson(
          "data/layers/carreteras_secundarias.geojson",
          secondaryRoadsLayer,
        ),
        loadGeoJson("data/layers/estanques_piscicolas.geojson", allPondsLayer),
      ]).catch((error) =>
        console.error("No se pudieron cargar las capas territoriales", error),
      );

      try {
        await import("leaflet-draw");
        if (cancelled) return;
        L.drawLocal.draw.toolbar.buttons.rectangle =
          "Seleccionar puntos mediante un rectángulo";
        L.drawLocal.draw.handlers.rectangle.tooltip.start =
          "Arrastre para dibujar el área de selección.";
        const drawnItems = L.featureGroup().addTo(map);
        drawnItemsRef.current = drawnItems;
        const drawControl = new L.Control.Draw({
          position: "topleft",
          draw: {
            polygon: false,
            polyline: false,
            rectangle: {
              shapeOptions: {
                color: "#f2c94c",
                fillColor: "#f2c94c",
                fillOpacity: 0.16,
                weight: 2,
              },
            },
            circle: false,
            marker: false,
            circlemarker: false,
          },
          edit: false,
        });
        map.addControl(drawControl);
        map.on(L.Draw.Event.CREATED, (event) => {
          const layer = event.layer;
          drawnItems.clearLayers();
          drawnItems.addLayer(layer);
          const bounds = (layer as import("leaflet").Rectangle).getBounds();
          const selectedIds = selectablePointsRef.current
            .filter((point) => bounds.contains([point.y, point.x]))
            .map((point) => point.id);
          onSpatialSelectRef.current(selectedIds);
        });
      } catch (error) {
        console.error("No se pudo iniciar la selección rectangular", error);
      }
    }
    initializeMap();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = null;
      drawnItemsRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const L = leafletRef.current;
    const map = mapRef.current;
    const group = markersRef.current;
    if (!L || !map || !group) return;
    group.clearLayers();
    const bounds = L.latLngBounds([]);
    points.forEach((point) => {
      let symbolValue = point.cover[0] ?? "Sin clase";
      if (symbolMode === "density") symbolValue = point.densityClass;
      if (symbolMode === "parcel") symbolValue = point.parcelClass;
      if (symbolMode === "selection" && selection) {
        symbolValue =
          selection.kind === "node" ? selection.cover : selection.targetCover;
      }
      const palette =
        symbolMode === "density" || symbolMode === "parcel"
          ? DENSITY_COLORS
          : COVER_COLORS;
      const color = palette[symbolValue] ?? "#1f7259";
      const marker = L.circleMarker([point.y, point.x], {
        pane: "samplePondsPane",
        radius: 5.5,
        weight: 1.25,
        color: "#ffffff",
        fillColor: color,
        fillOpacity: 0.92,
      });
      marker.bindPopup(
        `<div class="map-popup">
          <strong>${point.code}</strong>
          <span>${point.municipio}</span>
          <dl>
            <dt>Año de detección</dt><dd>${getDetectionYear(point, years) ?? "No detectado"}</dd>
            <dt>Área estanque</dt><dd>${formatNumber(point.area / 10000, 2)} ha</dd>
            <dt>Densidad</dt><dd>${formatNumber(point.density, 2)} est./km²</dd>
            <dt>Predio</dt><dd>${formatNumber(point.parcelArea, 2)} ha</dd>
          </dl>
        </div>`,
      );
      marker.addTo(group);
      bounds.extend([point.y, point.x]);
    });
    if (points.length && bounds.isValid()) {
      map.fitBounds(bounds, {
        padding: [28, 28],
        maxZoom: firstDraw.current || points.length === allCount ? 9 : 13,
      });
      firstDraw.current = false;
    }
  }, [points, allCount, mapReady, selection, symbolMode, years]);

  const legend =
    symbolMode === "density" || symbolMode === "parcel"
      ? DENSITY_COLORS
      : symbolMode === "selection" && selection
        ? {
            [selection.kind === "node"
              ? `${selection.cover} · ${selection.year}`
              : `${selection.targetCover} · ${selection.targetYear}`]:
              COVER_COLORS[
                selection.kind === "node"
                  ? selection.cover
                  : selection.targetCover
              ] ?? "#1f7259",
          }
        : COVER_COLORS;
  const legendTitle =
    symbolMode === "density"
      ? "Densidad"
      : symbolMode === "parcel"
        ? "Superficie del predio"
        : symbolMode === "selection"
          ? "Selección del gráfico"
          : "Cobertura 2010";

  return (
    <section className="map-card">
      <div className="map-title">
        <div>
          <span className="eyebrow">Cobertura & Piscicultura</span>
          <h1>Visor territorial de estanques</h1>
          <p>Explore los puntos y su cambio de cobertura entre 2010 y 2025.</p>
        </div>
        <div className="map-title-actions">
          {spatialSelectionCount !== null ? (
            <button
              className="spatial-clear"
              onClick={() => {
                drawnItemsRef.current?.clearLayers();
                onClearSpatialSelection();
              }}
            >
              Área seleccionada · {formatNumber(spatialSelectionCount)}
              <span aria-hidden="true">×</span>
            </button>
          ) : (
            <span className="draw-helper">Dibuje un rectángulo para filtrar</span>
          )}
          <span className="live-pill">{formatNumber(points.length)} visibles</span>
          <button className="filter-toggle" onClick={onOpenFilters}>
            Filtros
          </button>
        </div>
      </div>
      <div className="map-frame" ref={mapElement} />
      <div className="map-legend" aria-label={`Leyenda: ${legendTitle}`}>
        <strong>{legendTitle}</strong>
        {Object.entries(legend).map(([label, color]) => (
          <span key={label}>
            <i style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

export function PortalClient() {
  const [dataset, setDataset] = useState<PortalDataset | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [coverageSelection, setCoverageSelection] =
    useState<CoverageSelection>(null);
  const [spatialSelectionIds, setSpatialSelectionIds] =
    useState<Set<number> | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    fetch("data/points.json")
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar el conjunto de datos");
        return response.json();
      })
      .then(setDataset)
      .catch((error) => console.error(error));
  }, []);

  const updateFilter = useCallback(
    (key: keyof Filters, value: string) =>
      setFilters((current) => ({ ...current, [key]: value })),
    [],
  );

  const municipalities = useMemo(
    () =>
      dataset
        ? Array.from(
            new Set(dataset.points.map((point) => point.municipio)),
          ).sort((a, b) => a.localeCompare(b, "es"))
        : [],
    [dataset],
  );

  const baseFilteredPoints = useMemo(() => {
    if (!dataset) return [];
    const densityMin = Number(filters.densityMin);
    const densityMax = Number(filters.densityMax);
    const principalMax = Number(filters.principalMaxKm) * 1000;
    const secondaryMax = Number(filters.secondaryMaxKm) * 1000;
    const yearMin = Number(filters.yearMin);
    const yearMax = Number(filters.yearMax);
    const search = filters.search.trim().toLocaleLowerCase("es");
    return dataset.points.filter((point) => {
      const detectionYear = getDetectionYear(point, dataset.years);
      if (filters.municipio && point.municipio !== filters.municipio) return false;
      if (
        filters.densityClass &&
        point.densityClass !== filters.densityClass
      )
        return false;
      if (filters.parcelClass && point.parcelClass !== filters.parcelClass)
        return false;
      if (filters.densityMin && point.density < densityMin) return false;
      if (filters.densityMax && point.density > densityMax) return false;
      if (filters.principalMaxKm && point.principal > principalMax) return false;
      if (filters.secondaryMaxKm && point.secondary > secondaryMax) return false;
      if (
        filters.yearMin &&
        (detectionYear === null || detectionYear < yearMin)
      )
        return false;
      if (
        filters.yearMax &&
        (detectionYear === null || detectionYear > yearMax)
      )
        return false;
      if (
        search &&
        !point.code.toLocaleLowerCase("es").includes(search) &&
        !String(point.parcelId).includes(search)
      )
        return false;
      return true;
    });
  }, [dataset, filters]);

  const coverageCandidatePoints = useMemo(() => {
    if (!dataset || !coverageSelection) return baseFilteredPoints;
    if (coverageSelection.kind === "node") {
      const yearIndex = dataset.years.indexOf(coverageSelection.year);
      return baseFilteredPoints.filter(
        (point) => point.cover[yearIndex] === coverageSelection.cover,
      );
    }
    const sourceIndex = dataset.years.indexOf(coverageSelection.sourceYear);
    const targetIndex = dataset.years.indexOf(coverageSelection.targetYear);
    return baseFilteredPoints.filter(
      (point) =>
        point.cover[sourceIndex] === coverageSelection.sourceCover &&
        point.cover[targetIndex] === coverageSelection.targetCover,
    );
  }, [baseFilteredPoints, coverageSelection, dataset]);

  const spatialFilteredBasePoints = useMemo(
    () =>
      spatialSelectionIds
        ? baseFilteredPoints.filter((point) => spatialSelectionIds.has(point.id))
        : baseFilteredPoints,
    [baseFilteredPoints, spatialSelectionIds],
  );

  const filteredPoints = useMemo(
    () =>
      spatialSelectionIds
        ? coverageCandidatePoints.filter((point) =>
            spatialSelectionIds.has(point.id),
          )
        : coverageCandidatePoints,
    [coverageCandidatePoints, spatialSelectionIds],
  );

  const annualOption = useMemo<EChartsOption | null>(() => {
    if (!dataset) return null;
    const totals = new Map<string, number[]>();
    dataset.classes.forEach((cover) =>
      totals.set(cover, dataset.years.map(() => 0)),
    );
    spatialFilteredBasePoints.forEach((point) => {
      point.cover.forEach((cover, index) => {
        const values = totals.get(cover);
        if (values) values[index] += point.area / 10000;
      });
    });
    return {
      animationDuration: 500,
      color: dataset.classes.map((cover) => COVER_COLORS[cover]),
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => `${formatNumber(Number(value), 2)} ha`,
      },
      legend: {
        bottom: 0,
        textStyle: { color: "#355248", fontSize: 11 },
      },
      grid: { left: 62, right: 22, top: 24, bottom: 78 },
      xAxis: {
        type: "category",
        data: dataset.years,
        axisLine: { lineStyle: { color: "#9db0aa" } },
        axisLabel: { color: "#557069" },
      },
      yAxis: {
        type: "value",
        name: "Superficie (ha)",
        nameTextStyle: { color: "#557069" },
        axisLabel: {
          color: "#557069",
          formatter: (value: number) => formatNumber(value),
        },
        splitLine: { lineStyle: { color: "#e7eeeb" } },
      },
      series: dataset.classes.map((cover) => ({
        name: cover,
        type: "bar",
        stack: "cobertura",
        emphasis: { focus: "series" },
        data: totals.get(cover),
        itemStyle: {
          color: COVER_COLORS[cover],
          borderRadius: cover === dataset.classes.at(-1) ? [3, 3, 0, 0] : 0,
        },
      })),
    };
  }, [dataset, spatialFilteredBasePoints]);

  const sankeyOption = useMemo<EChartsOption | null>(() => {
    if (!dataset) return null;
    const yearIndexes = SANKEY_YEARS.map((year) => dataset.years.indexOf(year));
    const links = new Map<string, number>();
    spatialFilteredBasePoints.forEach((point) => {
      for (let index = 0; index < yearIndexes.length - 1; index += 1) {
        const sourceCover = point.cover[yearIndexes[index]];
        const targetCover = point.cover[yearIndexes[index + 1]];
        const source = `${SANKEY_YEARS[index]} · ${sourceCover}`;
        const target = `${SANKEY_YEARS[index + 1]} · ${targetCover}`;
        const key = `${source}|||${target}`;
        links.set(key, (links.get(key) ?? 0) + point.area / 10000);
      }
    });
    const sankeyLinks = Array.from(links.entries())
      .filter(([, value]) => value > 0)
      .map(([key, value]) => {
        const [source, target] = key.split("|||");
        return { source, target, value };
      });
    const activeNodeNames = new Set(
      sankeyLinks.flatMap((link) => [link.source, link.target]),
    );
    const nodes = SANKEY_YEARS.flatMap((year, depth) =>
      dataset.classes
        .map((cover) => ({
          name: `${year} · ${cover}`,
          depth,
          label:
            depth === SANKEY_YEARS.length - 1
              ? { position: "left", align: "right" }
              : { position: "right", align: "left" },
          itemStyle: {
            color: COVER_COLORS[cover],
            borderColor: "#ffffff",
            borderWidth: 1,
          },
        }))
        .filter((node) => activeNodeNames.has(node.name)),
    );
    return {
      animationDuration: 650,
      tooltip: {
        trigger: "item",
        formatter: (params: {
          dataType?: string;
          data?: { source?: string; target?: string; value?: number };
          name?: string;
          value?: number;
        }) => {
          if (params.dataType === "edge" && params.data) {
            return `<strong>${params.data.source}</strong><br/>→ ${params.data.target}<br/>${formatNumber(
              Number(params.data.value),
              2,
            )} ha`;
          }
          return `<strong>${params.name}</strong><br/>${formatNumber(
            Number(params.value),
            2,
          )} ha`;
        },
      },
      series: [
        {
          type: "sankey",
          data: nodes,
          links: sankeyLinks,
          left: 18,
          right: 28,
          top: 18,
          bottom: 20,
          nodeWidth: 14,
          nodeGap: 0,
          nodeAlign: "justify",
          layoutIterations: 48,
          draggable: true,
          emphasis: { focus: "adjacency" },
          labelLayout: {
            hideOverlap: true,
            moveOverlap: "shiftY",
          },
          label: {
            color: "#1f3f35",
            fontSize: 10,
            formatter: (params: { name?: string }) =>
              params.name?.replace(/^\d{4} · /, "") ?? "",
          },
          lineStyle: {
            color: "gradient",
            curveness: 0.5,
            opacity: 0.38,
          },
        },
      ],
    };
  }, [dataset, spatialFilteredBasePoints]);

  const sankeyFullscreenOption = useMemo<EChartsOption | null>(() => {
    if (!sankeyOption) return null;
    const sankeySeries = (
      Array.isArray(sankeyOption.series)
        ? sankeyOption.series
        : [sankeyOption.series]
    ).filter(Boolean) as Array<Record<string, unknown>>;
    const primarySeries = sankeySeries[0];
    const baseLabel = (primarySeries.label ?? {}) as Record<string, unknown>;
    return {
      ...sankeyOption,
      series: [
        {
          ...primarySeries,
          left: 28,
          right: 28,
          top: 10,
          bottom: 10,
          nodeWidth: 18,
          nodeGap: 0,
          label: {
            ...baseLabel,
            color: "#123c31",
            fontSize: 18,
            fontWeight: 700,
            lineHeight: 22,
            textBorderColor: "#ffffff",
            textBorderWidth: 4,
          },
        },
      ],
    };
  }, [sankeyOption]);

  const toggleCoverageSelection = useCallback(
    (next: Exclude<CoverageSelection, null>) => {
      setCoverageSelection((current) => {
        if (!current || current.kind !== next.kind) return next;
        if (
          current.kind === "node" &&
          next.kind === "node" &&
          current.year === next.year &&
          current.cover === next.cover
        )
          return null;
        if (
          current.kind === "transition" &&
          next.kind === "transition" &&
          current.sourceYear === next.sourceYear &&
          current.sourceCover === next.sourceCover &&
          current.targetYear === next.targetYear &&
          current.targetCover === next.targetCover
        )
          return null;
        return next;
      });
    },
    [],
  );

  const handleAnnualClick = useCallback(
    (params: Record<string, unknown>) => {
      if (params.seriesType !== "bar") return;
      const year = Number(params.name);
      const cover = String(params.seriesName ?? "");
      if (Number.isFinite(year) && cover) {
        toggleCoverageSelection({ kind: "node", year, cover });
      }
    },
    [toggleCoverageSelection],
  );

  const handleSankeyClick = useCallback(
    (params: Record<string, unknown>) => {
      const parseNode = (value: unknown) => {
        const match = String(value ?? "").match(/^(\d{4}) · (.+)$/);
        return match ? { year: Number(match[1]), cover: match[2] } : null;
      };
      if (params.dataType === "edge") {
        const data = params.data as
          | { source?: string; target?: string }
          | undefined;
        const source = parseNode(data?.source);
        const target = parseNode(data?.target);
        if (source && target) {
          toggleCoverageSelection({
            kind: "transition",
            sourceYear: source.year,
            sourceCover: source.cover,
            targetYear: target.year,
            targetCover: target.cover,
          });
        }
        return;
      }
      const node = parseNode(params.name);
      if (node) {
        toggleCoverageSelection({
          kind: "node",
          year: node.year,
          cover: node.cover,
        });
      }
    },
    [toggleCoverageSelection],
  );

  const symbolMode: MapSymbolMode = coverageSelection
    ? "selection"
    : filters.densityClass || filters.densityMin || filters.densityMax
      ? "density"
      : filters.parcelClass
        ? "parcel"
        : "coverage";

  const selectionLabel = coverageSelection
    ? coverageSelection.kind === "node"
      ? `${coverageSelection.cover} · ${coverageSelection.year}`
      : `${coverageSelection.sourceYear} ${coverageSelection.sourceCover} → ${coverageSelection.targetYear} ${coverageSelection.targetCover}`
    : "";

  const sidebarMetrics = useMemo(
    () => ({
      points: filteredPoints.length,
      area:
        filteredPoints.reduce((sum, point) => sum + point.area, 0) / 10000,
      municipalities: new Set(
        filteredPoints.map((point) => point.municipio),
      ).size,
    }),
    [filteredPoints],
  );

  if (!dataset) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">CC</div>
        <p>Cargando geoportal de cobertura…</p>
      </main>
    );
  }

  return (
    <main className="portal-shell">
      <div className="portal-grid">
        <aside className={`filters-panel ${filterOpen ? "filters-open" : ""}`}>
          <div className="filters-header">
            <div>
              <span className="eyebrow">Explorar datos</span>
              <h1>Filtros</h1>
            </div>
            <button
              className="close-filters"
              onClick={() => setFilterOpen(false)}
              aria-label="Cerrar filtros"
            >
              ×
            </button>
          </div>

          <div className="sidebar-metrics" aria-label="Resumen de la selección">
            <article>
              <span>Puntos</span>
              <strong>{formatNumber(sidebarMetrics.points)}</strong>
            </article>
            <article>
              <span>Área</span>
              <strong>{formatNumber(sidebarMetrics.area, 1)}</strong>
              <small>ha</small>
            </article>
            <article>
              <span>Municipios</span>
              <strong>{sidebarMetrics.municipalities}</strong>
            </article>
          </div>

          <label className="filter-field">
            <span>Municipio</span>
            <select
              value={filters.municipio}
              onChange={(event) => updateFilter("municipio", event.target.value)}
            >
              <option value="">Todos los municipios</option>
              {municipalities.map((municipio) => (
                <option key={municipio}>{municipio}</option>
              ))}
            </select>
          </label>

          <div className="filter-row">
            <label className="filter-field">
              <span>Densidad</span>
              <select
                value={filters.densityClass}
                onChange={(event) =>
                  updateFilter("densityClass", event.target.value)
                }
              >
                <option value="">Todas</option>
                <option>Baja</option>
                <option>Media</option>
                <option>Alta</option>
              </select>
            </label>
            <label className="filter-field">
              <span>Predio</span>
              <select
                value={filters.parcelClass}
                onChange={(event) =>
                  updateFilter("parcelClass", event.target.value)
                }
              >
                <option value="">Todos</option>
                <option>Baja</option>
                <option>Media</option>
                <option>Alta</option>
              </select>
            </label>
          </div>

          <div className="filter-group">
            <span className="group-label">Valor de densidad · est./km²</span>
            <div className="filter-row">
              <label className="filter-field compact">
                <span>Mínimo</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="0"
                  value={filters.densityMin}
                  onChange={(event) =>
                    updateFilter("densityMin", event.target.value)
                  }
                />
              </label>
              <label className="filter-field compact">
                <span>Máximo</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  placeholder="44,4"
                  value={filters.densityMax}
                  onChange={(event) =>
                    updateFilter("densityMax", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="filter-group">
            <span className="group-label">Distancia máxima a caminos</span>
            <div className="filter-row">
              <label className="filter-field compact">
                <span>Principal · km</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Sin límite"
                  value={filters.principalMaxKm}
                  onChange={(event) =>
                    updateFilter("principalMaxKm", event.target.value)
                  }
                />
              </label>
              <label className="filter-field compact">
                <span>Secundario · km</span>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Sin límite"
                  value={filters.secondaryMaxKm}
                  onChange={(event) =>
                    updateFilter("secondaryMaxKm", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="filter-group">
            <span className="group-label">
              Año de detección · primera cobertura “Estanques”
            </span>
            <div className="filter-row">
              <label className="filter-field compact">
                <span>Desde</span>
                <input
                  type="number"
                  min="2010"
                  max="2025"
                  placeholder="2010"
                  value={filters.yearMin}
                  onChange={(event) => updateFilter("yearMin", event.target.value)}
                />
              </label>
              <label className="filter-field compact">
                <span>Hasta</span>
                <input
                  type="number"
                  min="2010"
                  max="2025"
                  placeholder="2025"
                  value={filters.yearMax}
                  onChange={(event) => updateFilter("yearMax", event.target.value)}
                />
              </label>
            </div>
          </div>

          <label className="filter-field">
            <span>Código de estanque o predio</span>
            <input
              type="search"
              placeholder="Ej. 235_09SC"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
            />
          </label>

          <button
            className="reset-button"
            onClick={() => {
              setFilters(initialFilters);
              setCoverageSelection(null);
              setSpatialSelectionIds(null);
            }}
          >
            Limpiar todos los filtros
          </button>
          <p className="filter-note">
            Los filtros actualizan simultáneamente los puntos del mapa y los
            gráficos.
          </p>
        </aside>

        <section className="workspace">
          <PortalMap
            points={filteredPoints}
            selectablePoints={coverageCandidatePoints}
            allCount={dataset.points.length}
            years={dataset.years}
            symbolMode={symbolMode}
            selection={coverageSelection}
            spatialSelectionCount={
              spatialSelectionIds ? filteredPoints.length : null
            }
            onOpenFilters={() => setFilterOpen(true)}
            onSpatialSelect={(pointIds) =>
              setSpatialSelectionIds(new Set(pointIds))
            }
            onClearSpatialSelection={() => setSpatialSelectionIds(null)}
          />

          <div className="analysis-heading">
            <div>
              <span className="eyebrow">Análisis de cambio</span>
              <h2>Evolución de la cobertura</h2>
              <p>
                Haz clic en una barra, nodo o flujo para filtrar los puntos del
                mapa.
              </p>
            </div>
            {coverageSelection ? (
              <button
                className="selection-chip"
                onClick={() => setCoverageSelection(null)}
                title="Quitar selección del gráfico"
              >
                {selectionLabel}
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </div>

          <div className="charts-grid">
            <ChartCard
              title="Evolución anual de la cobertura"
              subtitle="Superficie agregada por clase de cobertura, 2010–2025."
              option={annualOption}
              filename="evolucion_anual_cobertura"
              onChartClick={handleAnnualClick}
            />
            <ChartCard
              title="Transiciones quinquenales"
              subtitle="Flujos de cobertura entre 2010, 2015, 2020 y 2025."
              option={sankeyOption}
              fullscreenOption={sankeyFullscreenOption}
              filename="sankey_cambio_cobertura"
              onChartClick={handleSankeyClick}
            />
          </div>

          <footer className="portal-footer">
            <span>
              Fuente: COBERTURA_TOTAL2.xlsx · Clasificación visual multitemporal
            </span>
            <span>Último periodo: 2025</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
