// 実行時の設定。既定のままで、静的ファイルを配るだけのサイト（GitHub Pages など）として動く。
//
// 認証付きのサーバーの後ろに置く場合だけ、sessionWatch を設定する。
// 静的データ・フォントの取得が 401/403 になった（ログインが切れた）ときに案内を出し、
// タブに戻ったときにも確認する。null なら何もしない。
//
//   sessionWatch: {
//     message: 'ログインが切れました。',           // バナーの文言
//     loginUrl: '/login/',                          // 「ログイン」ボタンの移動先
//     loginLabel: 'ログイン',                       // 同ボタンの表示
//   }
export const config = {
  sessionWatch: null,
};
