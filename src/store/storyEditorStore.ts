// Story Studioの編集状態。レイヤーは配列で管理し、配列のindexがそのままz順（末尾が最前面）。
// この形はstory_drafts.layers_jsonの保存フォーマットとほぼ同一なので、
// 保存・再編集時の変換ロスがない。
import { create } from 'zustand';

export type LayerType = 'background' | 'photo' | 'frame' | 'flower' | 'decoration' | 'text' | 'cta';

interface BaseLayer {
  id: string;
  type: LayerType;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  visible: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: 'background' | 'frame' | 'flower' | 'decoration';
  uri: string;
}

export interface PhotoLayer extends BaseLayer {
  type: 'photo';
  uri: string;
  /** トリミング範囲（0〜1の正規化）。未指定なら全体を使う */
  cropX?: number;
  cropY?: number;
  cropW?: number;
  cropH?: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text' | 'cta';
  text: string;
  font: string;
  color: string;
  size: number;
}

export type StoryLayer = ImageLayer | PhotoLayer | TextLayer;

interface StoryEditorState {
  templateId: string | null;
  layers: StoryLayer[];
  selectedLayerId: string | null;

  loadLayers: (templateId: string | null, layers: StoryLayer[]) => void;
  reset: () => void;

  selectLayer: (id: string | null) => void;
  updateLayer: (id: string, patch: Partial<StoryLayer>) => void;
  addLayer: (layer: StoryLayer) => void;
  removeLayer: (id: string) => void;
  reorderLayers: (fromIndex: number, toIndex: number) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  toggleVisible: (id: string) => void;
}

export const useStoryEditorStore = create<StoryEditorState>((set, get) => ({
  templateId: null,
  layers: [],
  selectedLayerId: null,

  loadLayers: (templateId, layers) => set({ templateId, layers, selectedLayerId: null }),
  reset: () => set({ templateId: null, layers: [], selectedLayerId: null }),

  selectLayer: (id) => set({ selectedLayerId: id }),

  updateLayer: (id, patch) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as StoryLayer) : l)),
    })),

  addLayer: (layer) => set((state) => ({ layers: [...state.layers, layer], selectedLayerId: layer.id })),

  removeLayer: (id) =>
    set((state) => ({
      layers: state.layers.filter((l) => l.id !== id),
      selectedLayerId: state.selectedLayerId === id ? null : state.selectedLayerId,
    })),

  reorderLayers: (fromIndex, toIndex) =>
    set((state) => {
      const next = [...state.layers];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { layers: next };
    }),

  bringToFront: (id) =>
    set((state) => {
      const target = state.layers.find((l) => l.id === id);
      if (!target) return state;
      return { layers: [...state.layers.filter((l) => l.id !== id), target] };
    }),

  sendToBack: (id) =>
    set((state) => {
      const target = state.layers.find((l) => l.id === id);
      if (!target) return state;
      return { layers: [target, ...state.layers.filter((l) => l.id !== id)] };
    }),

  toggleVisible: (id) =>
    set((state) => ({
      layers: state.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    })),
}));

/** 保存用JSONへの変換（そのままlayers配列を保存するだけ） */
export function serializeLayers(layers: StoryLayer[]): unknown {
  return { layers };
}

export function deserializeLayers(json: any): StoryLayer[] {
  if (!json || !Array.isArray(json.layers)) return [];
  return json.layers as StoryLayer[];
}
