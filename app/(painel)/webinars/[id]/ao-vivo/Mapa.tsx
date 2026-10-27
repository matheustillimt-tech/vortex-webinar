"use client";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";

export type Ponto = { lat: number; lon: number };

const CENTRO_PADRAO: [number, number] = [-14.235, -51.9253]; // Brasil, zoom bem afastado sem pontos
const ZOOM_PADRAO = 4;

/** Mapa Leaflet (só cliente, carregado via `dynamic(..., { ssr: false })` por quem chama) — um círculo por sessão
 *  online com geolocalização. "Enquadrar público" ajusta o zoom/centro pros pontos atuais. */
export function Mapa({ pontos }: { pontos: Ponto[] }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current, { center: CENTRO_PADRAO, zoom: ZOOM_PADRAO, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(mapa);
    camadaRef.current = L.layerGroup().addTo(mapa);
    mapaRef.current = mapa;
    return () => {
      mapa.remove();
      mapaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const camada = camadaRef.current;
    if (!camada) return;
    camada.clearLayers();
    for (const p of pontos) {
      L.circleMarker([p.lat, p.lon], { radius: 6, color: "#0a8452", weight: 1, fillColor: "#0a8452", fillOpacity: 0.6 }).addTo(camada);
    }
  }, [pontos]);

  function enquadrar() {
    const mapa = mapaRef.current;
    if (!mapa || pontos.length === 0) return;
    const limites = L.latLngBounds(pontos.map((p) => [p.lat, p.lon] as [number, number]));
    mapa.fitBounds(limites, { padding: [24, 24], maxZoom: 12 });
  }

  return (
    <div className="relative">
      <div ref={divRef} className="h-[360px] w-full rounded-lg" />
      <button
        type="button"
        onClick={enquadrar}
        className="absolute right-2 top-2 z-[500] rounded-md border border-vg-line bg-vg-bg/90 px-2.5 py-1.5 text-xs font-medium text-vg-text shadow hover:bg-vg-panel-2"
      >
        Enquadrar público
      </button>
    </div>
  );
}

export default Mapa;
