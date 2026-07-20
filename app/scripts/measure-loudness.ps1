# WorkSpace — measure integrated loudness (LUFS) + true peak of every focus-music
# track with ffmpeg's loudnorm, so the app can normalize each track to a common
# target. READ-ONLY: measures only, never re-encodes. Writes app/scripts/loudness.json
# keyed by "<Genre folder>/<file>.mp3" → { i: integrated LUFS, tp: true peak dBTP }.
$ErrorActionPreference = 'Continue'
$md = "C:\Users\jonle\Dropbox\Gabriel\AI Projects\Work Wave\Music Database"
$genres = @(
  "Genre 1 - Classical Piano",
  "Genre 2 - Solo Bach",
  "Genre 3 - Baroque",
  "Genre 4 - Impressionist Piano",
  "Genre 5 - Romantic Piano"
)
$result = [ordered]@{}
$n = 0
foreach ($g in $genres) {
  $dir = Join-Path $md $g
  foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter *.mp3 | Sort-Object Name)) {
    $n++
    $out = & ffmpeg -hide_banner -nostats -i $f.FullName -af "loudnorm=I=-16:print_format=json" -f null - 2>&1 | Out-String
    $key = "$g/$($f.Name)"
    try {
      $i0 = $out.IndexOf("{")
      $i1 = $out.IndexOf("}", $i0)
      $j = $out.Substring($i0, $i1 - $i0 + 1) | ConvertFrom-Json
      $result[$key] = @{ i = [double]$j.input_i; tp = [double]$j.input_tp }
      Write-Output ("{0,3}  {1,7:N2} LUFS  tp {2,6:N2}  {3}" -f $n, [double]$j.input_i, [double]$j.input_tp, $f.Name)
    } catch {
      $result[$key] = @{ i = $null; tp = $null }
      Write-Output ("{0,3}  FAILED  {1}" -f $n, $f.Name)
    }
  }
}
$outPath = "C:\Users\jonle\Dropbox\Gabriel\AI Projects\Work Wave\app\scripts\loudness.json"
$result | ConvertTo-Json -Depth 5 | Out-File -FilePath $outPath -Encoding utf8
# quick summary
$vals = $result.Values | Where-Object { $_.i -ne $null } | ForEach-Object { $_.i }
$mean = ($vals | Measure-Object -Average).Average
$min = ($vals | Measure-Object -Minimum).Minimum
$max = ($vals | Measure-Object -Maximum).Maximum
Write-Output ("DONE {0} tracks | mean {1:N2} LUFS | range {2:N2}..{3:N2} | -> {4}" -f $result.Count, $mean, $min, $max, $outPath)
