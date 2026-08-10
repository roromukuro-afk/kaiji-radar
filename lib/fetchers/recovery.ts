/**
 * 全情報源の自動取りこぼし回収(新規実装6)
 *
 * TDnetは元々「前回実行からの経過時間」で遡及取得幅を決めていたが、
 * これは全ソース共通の1つの値でしかなく、特定のソースだけが連続失敗した
 * 場合の取りこぼしを検知できなかった。source_checkpoints(ソースごとの
 * 最終成功時刻)を使い、ソースごとに独立した遡及幅を計算する。
 */

export interface RecoveryWindow {
  since: Date;
  isRecovery: boolean;
  lookbackHours: number;
}

/**
 * @param lastSuccessAt そのソースが最後に成功した時刻(source_checkpoints由来、無ければnull)
 * @param normalLookbackHours 平常時の遡及幅(取得境界付近の取りこぼし防止用の小さな値)
 * @param capHours 障害復旧時でもこれ以上は遡及しない上限(ソースごとに異なる)
 */
export function computeRecoveryWindow(
  lastSuccessAt: string | null,
  normalLookbackHours: number,
  capHours: number,
  now: number = Date.now()
): RecoveryWindow {
  if (!lastSuccessAt) {
    return { since: new Date(now - normalLookbackHours * 3600000), isRecovery: false, lookbackHours: normalLookbackHours };
  }

  const hoursSince = (now - new Date(lastSuccessAt).getTime()) / 3600000;
  // 平常運転の揺れ(実行間隔のばらつき等)では復旧モードにしない
  if (hoursSince <= normalLookbackHours * 1.5) {
    return { since: new Date(now - normalLookbackHours * 3600000), isRecovery: false, lookbackHours: normalLookbackHours };
  }

  const capped = Math.min(hoursSince, capHours);
  return { since: new Date(now - capped * 3600000), isRecovery: true, lookbackHours: Math.round(capped * 10) / 10 };
}
