// 「ストーリー作成」共通エディターの編集状態。
// 旧storyEditorStore.tsの単一`layers`配列を、CreativeTemplateの形（photoSlots/layers/textLayers）
// に合わせて3つに分ける。各配列内での並び順がそのままその帯（band）内でのz順になる
// （旧ストアの「配列の末尾が最前面」という規約を踏襲）。写真スロット自体の重なり順は
// photoSlots配列の順序で決まり、描画順序（背景→背面装飾→写真→前面装飾→フレーム→文字）は
// CreativeCanvas側で固定的に扱うため、ここでは扱わない。
import { create } from 'zustand';
import { PhotoSlot, TemplateLayer, TextLayer, PhotoLayer } from '../types/creativeTemplate';

export interface PhotoAssignment {
  slotId: string;
  uri: string;
  /** スロット中心を基準にしたパン量（論理キャンバス基準px） */
  offsetX: number;
  offsetY: number;
  /** スロットをcoverする最小倍率を1.0とした追加倍率 */
  scale: number;
  /** 写真自身の中心を軸にした回転角度（度） */
  rotation: number;
  naturalW: number;
  naturalH: number;
}

interface CreativeEditorState {
  templateId: string | null;
  photoSlots: PhotoSlot[];
  photoAssignments: PhotoAssignment[];
  layers: TemplateLayer[];
  textLayers: TextLayer[];
  /** スロットに縛られず自由に配置できる「追加写真」（ステッカーのように移動・拡大縮小・
   *  回転できる）。テンプレートには含まれず、「ストーリー作成」画面でユーザーが
   *  追加した分だけ増える */
  photoLayers: PhotoLayer[];
  /** 選択中の要素id。photoSlot/layer/textLayer/photoLayerのいずれかのidを指す */
  selectedId: string | null;
  /** 現在操作対象にしているスロットid。photoSlots.length>=2の時だけ意味を持つ */
  activeSlotId: string | null;

  loadTemplate: (params: { templateId: string; photoSlots: PhotoSlot[]; layers: TemplateLayer[]; textLayers: TextLayer[] }) => void;
  reset: () => void;

  selectItem: (id: string | null) => void;
  setActiveSlot: (slotId: string | null) => void;

  assignPhoto: (slotId: string, uri: string, naturalW: number, naturalH: number) => void;
  updatePhotoAssignment: (slotId: string, patch: Partial<Pick<PhotoAssignment, 'offsetX' | 'offsetY' | 'scale' | 'rotation'>>) => void;
  swapPhotoAssignments: (slotIdA: string, slotIdB: string) => void;

  updateLayer: (id: string, patch: Partial<TemplateLayer>) => void;
  /** 背景（kind:'background'）レイヤーだけを置き換える・追加する・削除する（nullで削除）。
   *  写真スロット・写真の割当・テキストは一切変更しない。写真を拡大率1.0未満に縮小して
   *  スロット内に余白ができた時、その余白に背景を表示できるようにするため、写真と背景は
   *  互いに独立して設定できる必要がある */
  setBackgroundLayer: (bgLayer: TemplateLayer | null) => void;

  addTextLayer: (layer: TextLayer) => void;
  updateTextLayer: (id: string, patch: Partial<TextLayer>) => void;
  removeTextLayer: (id: string) => void;
  toggleTextVisible: (id: string) => void;

  addPhotoLayer: (layer: PhotoLayer) => void;
  updatePhotoLayer: (id: string, patch: Partial<Pick<PhotoLayer, 'x' | 'y' | 'scale' | 'rotation'>>) => void;
  removePhotoLayer: (id: string) => void;

  /** idを含む配列（layers or textLayers or photoLayers）内で、その要素を末尾（最前面）へ移動する */
  bringToFront: (id: string) => void;
  /** idを含む配列（layers or textLayers or photoLayers）内で、その要素を先頭（最背面）へ移動する */
  sendToBack: (id: string) => void;
}

export const useCreativeEditorStore = create<CreativeEditorState>((set, get) => ({
  templateId: null,
  photoSlots: [],
  photoAssignments: [],
  layers: [],
  textLayers: [],
  photoLayers: [],
  selectedId: null,
  activeSlotId: null,

  loadTemplate: ({ templateId, photoSlots, layers, textLayers }) =>
    set({
      templateId, photoSlots, layers, textLayers,
      photoAssignments: [],
      photoLayers: [],
      selectedId: null,
      activeSlotId: photoSlots[0]?.id ?? null,
    }),
  reset: () => set({
    templateId: null, photoSlots: [], photoAssignments: [], layers: [], textLayers: [], photoLayers: [],
    selectedId: null, activeSlotId: null,
  }),

  selectItem: (id) => set({ selectedId: id }),
  setActiveSlot: (slotId) => set({ activeSlotId: slotId, selectedId: slotId }),

  assignPhoto: (slotId, uri, naturalW, naturalH) =>
    set((state) => {
      const existing = state.photoAssignments.find((a) => a.slotId === slotId);
      const next: PhotoAssignment = { slotId, uri, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, naturalW, naturalH };
      return {
        photoAssignments: existing
          ? state.photoAssignments.map((a) => (a.slotId === slotId ? next : a))
          : [...state.photoAssignments, next],
      };
    }),
  updatePhotoAssignment: (slotId, patch) =>
    set((state) => ({
      photoAssignments: state.photoAssignments.map((a) => (a.slotId === slotId ? { ...a, ...patch } : a)),
    })),
  swapPhotoAssignments: (slotIdA, slotIdB) =>
    set((state) => {
      const a = state.photoAssignments.find((x) => x.slotId === slotIdA);
      const b = state.photoAssignments.find((x) => x.slotId === slotIdB);
      return {
        photoAssignments: state.photoAssignments.map((x) => {
          if (x.slotId === slotIdA && b) return { ...b, slotId: slotIdA };
          if (x.slotId === slotIdB && a) return { ...a, slotId: slotIdB };
          return x;
        }),
      };
    }),

  updateLayer: (id, patch) =>
    set((state) => ({ layers: state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
  setBackgroundLayer: (bgLayer) =>
    set((state) => ({
      layers: bgLayer
        ? [bgLayer, ...state.layers.filter((l) => l.kind !== 'background')]
        : state.layers.filter((l) => l.kind !== 'background'),
    })),

  addTextLayer: (layer) =>
    set((state) => ({ textLayers: [...state.textLayers, layer], selectedId: layer.id })),
  updateTextLayer: (id, patch) =>
    set((state) => ({ textLayers: state.textLayers.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTextLayer: (id) =>
    set((state) => ({
      textLayers: state.textLayers.filter((t) => t.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
  toggleTextVisible: (id) =>
    set((state) => ({ textLayers: state.textLayers.map((t) => (t.id === id ? { ...t, visible: !t.visible } : t)) })),

  addPhotoLayer: (layer) =>
    set((state) => ({ photoLayers: [...state.photoLayers, layer], selectedId: layer.id })),
  updatePhotoLayer: (id, patch) =>
    set((state) => ({ photoLayers: state.photoLayers.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  removePhotoLayer: (id) =>
    set((state) => ({
      photoLayers: state.photoLayers.filter((p) => p.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),

  bringToFront: (id) => {
    const state = get();
    if (state.layers.some((l) => l.id === id)) {
      const target = state.layers.find((l) => l.id === id)!;
      set({ layers: [...state.layers.filter((l) => l.id !== id), target] });
    } else if (state.textLayers.some((t) => t.id === id)) {
      const target = state.textLayers.find((t) => t.id === id)!;
      set({ textLayers: [...state.textLayers.filter((t) => t.id !== id), target] });
    } else if (state.photoLayers.some((p) => p.id === id)) {
      const target = state.photoLayers.find((p) => p.id === id)!;
      set({ photoLayers: [...state.photoLayers.filter((p) => p.id !== id), target] });
    }
  },
  sendToBack: (id) => {
    const state = get();
    if (state.layers.some((l) => l.id === id)) {
      const target = state.layers.find((l) => l.id === id)!;
      set({ layers: [target, ...state.layers.filter((l) => l.id !== id)] });
    } else if (state.textLayers.some((t) => t.id === id)) {
      const target = state.textLayers.find((t) => t.id === id)!;
      set({ textLayers: [target, ...state.textLayers.filter((t) => t.id !== id)] });
    } else if (state.photoLayers.some((p) => p.id === id)) {
      const target = state.photoLayers.find((p) => p.id === id)!;
      set({ photoLayers: [target, ...state.photoLayers.filter((p) => p.id !== id)] });
    }
  },
}));

/** 保存用JSONへの変換。CreativeTemplate.definitionと同じ形（photoSlots/layers/textLayers）を返す */
export function serializeCreativeEditor(state: Pick<CreativeEditorState, 'photoSlots' | 'layers' | 'textLayers'>) {
  return { version: 1 as const, photoSlots: state.photoSlots, layers: state.layers, textLayers: state.textLayers };
}
