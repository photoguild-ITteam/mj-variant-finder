// 画面全体で共有する状態。VariantDB の読み込み後に db が入る。

export const app = {
  /**
   * 起動時（app.js の init）に読み込む。各部品は読み込んだ後に動かすので、null のまま使われることは無い
   * @type {import('../db.js').VariantDB}
   */
  db: /** @type {any} */ (null),
  /**
   * 絞り込み条件（db.search に渡す）
   * @type {import('../db.js').Filters}
   */
  filters: {},
  /** 表示中の検索語と結果（非同期の描画が古い結果を上書きしないよう照合に使う） */
  query: '',
  /** @type {ReturnType<import('../db.js').VariantDB['search']> | null} */
  result: null,
};
