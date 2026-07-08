module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimatedのworklet変換用プラグイン。プラグイン一覧の最後に置く必要がある。
    plugins: ['react-native-reanimated/plugin'],
  };
};
