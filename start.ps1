Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  EMA9 Dashboard - Production Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build React frontend
Write-Host "[1/2] Building frontend..." -ForegroundColor Yellow
Set-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Frontend build failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Set-Location ..

# Step 2: Start backend
Write-Host ""
Write-Host "[2/2] Starting server..." -ForegroundColor Yellow
Write-Host "      Local:  http://localhost:3200" -ForegroundColor Green
Write-Host "      Ngrok link will appear in a moment..." -ForegroundColor Green
Write-Host ""
node server.js
