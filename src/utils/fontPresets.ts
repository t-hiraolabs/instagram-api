// 「ストーリー作成」共通フォントプリセット。
// 旧Story Studioの4プリセットは実際にはfontFamilyへ反映されておらず視覚的に無効だった。
// 旧Collageの29プリセットはGoogle Fontsの<link>動的注入によるWeb専用実装で、ネイティブでは
// 動作しない。expo-font（既にインストール済み）+ @expo-google-fonts/* の実フォントファイルを
// バンドルすることで、Web・ネイティブ両方で同じfontFamilyが同じ見た目で使えるようにする。
import { useFonts } from '@expo-google-fonts/zen-kaku-gothic-new';
import { ZenKakuGothicNew_900Black } from '@expo-google-fonts/zen-kaku-gothic-new';
import { ShipporiMincho_800ExtraBold } from '@expo-google-fonts/shippori-mincho';
import { MPLUSRounded1c_800ExtraBold } from '@expo-google-fonts/m-plus-rounded-1c';
import { KaiseiDecol_700Bold } from '@expo-google-fonts/kaisei-decol';
import { ZenMaruGothic_900Black } from '@expo-google-fonts/zen-maru-gothic';
import { Yomogi_400Regular } from '@expo-google-fonts/yomogi';
import { ReggaeOne_400Regular } from '@expo-google-fonts/reggae-one';
import { DelaGothicOne_400Regular } from '@expo-google-fonts/dela-gothic-one';
import { KosugiMaru_400Regular } from '@expo-google-fonts/kosugi-maru';
import { KleeOne_400Regular } from '@expo-google-fonts/klee-one';
import { HinaMincho_400Regular } from '@expo-google-fonts/hina-mincho';
import { RampartOne_400Regular } from '@expo-google-fonts/rampart-one';
import { YujiSyuku_400Regular } from '@expo-google-fonts/yuji-syuku';
import { PottaOne_400Regular } from '@expo-google-fonts/potta-one';
import { Stick_400Regular } from '@expo-google-fonts/stick';
import { MochiyPopOne_400Regular } from '@expo-google-fonts/mochiy-pop-one';
import { RocknRollOne_400Regular } from '@expo-google-fonts/rocknroll-one';
import { ShipporiAntique_400Regular } from '@expo-google-fonts/shippori-antique';
import { DarumadropOne_400Regular } from '@expo-google-fonts/darumadrop-one';

export interface FontPreset {
  id: string;
  label: string;
  /** RNの`fontFamily`にそのまま渡せる、@expo-google-fonts/*がuseFontsに登録するキー名 */
  family: string;
  fontWeight: '400' | '700' | '800' | '900';
}

export const FONT_PRESETS: FontPreset[] = [
  { id: 'gothic', label: 'ゴシック（極太）', family: 'ZenKakuGothicNew_900Black', fontWeight: '900' },
  { id: 'mincho', label: '明朝（上品）', family: 'ShipporiMincho_800ExtraBold', fontWeight: '800' },
  { id: 'rounded', label: '丸ゴシック（やわらか）', family: 'MPLUSRounded1c_800ExtraBold', fontWeight: '800' },
  { id: 'decor', label: '装飾セリフ', family: 'KaiseiDecol_700Bold', fontWeight: '700' },
  { id: 'zenmaru', label: '丸ゴシック（Zen）', family: 'ZenMaruGothic_900Black', fontWeight: '900' },
  { id: 'yomogi', label: '手書き風（よもぎ）', family: 'Yomogi_400Regular', fontWeight: '400' },
  { id: 'reggae', label: 'レトロ（レゲエ）', family: 'ReggaeOne_400Regular', fontWeight: '400' },
  { id: 'delagothic', label: 'インパクト（Dela）', family: 'DelaGothicOne_400Regular', fontWeight: '400' },
  { id: 'kosugimaru', label: '丸ゴシック（親しみやすい）', family: 'KosugiMaru_400Regular', fontWeight: '400' },
  { id: 'klee', label: '手書き風（やわらか）', family: 'KleeOne_400Regular', fontWeight: '400' },
  { id: 'hinamincho', label: 'レトロ明朝（上品）', family: 'HinaMincho_400Regular', fontWeight: '400' },
  { id: 'rampart', label: '立体ポップ（インパクト）', family: 'RampartOne_400Regular', fontWeight: '400' },
  { id: 'yujisyuku', label: '筆文字（和風）', family: 'YujiSyuku_400Regular', fontWeight: '400' },
  { id: 'potta', label: 'ポップ（コミカル）', family: 'PottaOne_400Regular', fontWeight: '400' },
  { id: 'stick', label: 'スタンプ風（カジュアル）', family: 'Stick_400Regular', fontWeight: '400' },
  { id: 'mochiy', label: '丸ポップ（かわいい）', family: 'MochiyPopOne_400Regular', fontWeight: '400' },
  { id: 'rocknroll', label: 'モダン（スタイリッシュ）', family: 'RocknRollOne_400Regular', fontWeight: '400' },
  { id: 'shipporiantique', label: 'アンティーク（上品）', family: 'ShipporiAntique_400Regular', fontWeight: '400' },
  { id: 'darumadrop', label: '丸文字（コミカル）', family: 'DarumadropOne_400Regular', fontWeight: '400' },
];

export const DEFAULT_FONT_PRESET = FONT_PRESETS[0];

export function getFontPreset(id: string | undefined): FontPreset {
  return FONT_PRESETS.find((f) => f.id === id) ?? DEFAULT_FONT_PRESET;
}

/** App起動時に1回呼び出し、全プリセットのフォントファイルを読み込む。
 *  読み込み完了までは`fontsLoaded`がfalseになるので、呼び出し側でローディング表示に使う。 */
export function useCreativeFonts(): boolean {
  const [fontsLoaded] = useFonts({
    ZenKakuGothicNew_900Black,
    ShipporiMincho_800ExtraBold,
    MPLUSRounded1c_800ExtraBold,
    KaiseiDecol_700Bold,
    ZenMaruGothic_900Black,
    Yomogi_400Regular,
    ReggaeOne_400Regular,
    DelaGothicOne_400Regular,
    KosugiMaru_400Regular,
    KleeOne_400Regular,
    HinaMincho_400Regular,
    RampartOne_400Regular,
    YujiSyuku_400Regular,
    PottaOne_400Regular,
    Stick_400Regular,
    MochiyPopOne_400Regular,
    RocknRollOne_400Regular,
    ShipporiAntique_400Regular,
    DarumadropOne_400Regular,
  });
  return fontsLoaded;
}
