// 画面全体で共有する状態。VariantDB の読み込み後に db が入る。

export const app = {
  /** @type {import('../db.js').VariantDB | null} */
  db: null,
  /** 絞り込み条件（db.search に渡す） */
  filters: {},
  /** 表示中の検索語と結果（非同期の描画が古い結果を上書きしないよう照合に使う） */
  query: '',
  result: null,
};
