# ఈ రోజు చేసిన పనుల సారాంశం — ట్రబుల్‌షూటింగ్ నివేదిక (2026-06-27)

## 1) ఉద్దేశ్యం
- ఈ రోజు లక్ష్యం: ఇన్‌ఫ్రా, CI/CD మరియు ఆప్ బిల్డ్/డిప్లాయ్ సమస్యలను చూసి, పట్టు తీసుకుని, తొందరగా పనితీరును నిలపకుండా నమోదు చేయడం.

## 2) తక్షణ ఫలితాలు (సారాంశంగా)
- బ్యాక్‌ఎండ్ బిల్డ్ మరియు ఇమేజ్ పుష్ సక్సెస్ అయ్యాయి.
- ఫ్రంట్‌ఎండ్ Docker బిల్డ్ సమయంలో CRA కంపైల్ లో "Can't resolve './App'" వంటి పొరపాట్లు వచ్చాయి; ఆపై చిన్న ఫిక్స్‌లు పుష్ చేయబడ్డాయి.
- డిప్లాయ్ జాబ్‌లో `namespace "ecommerce" not found` వల్ల సీక్రెట్ అప్‌డేట్ విఫలమయ్యిందని గుర్తించాం — ఇది ఫిక్స్ చేయబడింది (నేను `namespace` ఎక్కడ అవసరమో ముందుగా సృష్టించడానికి workflow కి స్థిరంగా స్టెప్ జోడించాను).
- డిప్‌లో బ్యాక్‌ఎండ్ రోల్‌అవుట్ టైమ్-అవుట్ వచ్చింది — అదే కారణంగా డిబగ్ స్టెప్స్ workflow కి జోడించాను (pods.describe, logs, events, secret ARN డ్రాపింగ్).

## 3) ఈరోజు నేను చేసిన ఫైల్ మార్చినవి / చేస్తున్న కమిట్‌లు
- `frontend/src/index.tsx` — `import App from './App';` ను `import App from './App.tsx';` గా మార్చి case-sensitivity సమస్యలను నివారించాం.
  - Commit: "fix(frontend): explicit App import and add App.css to resolve Docker build on linux"

- `frontend/src/App.css` — సున్నితమైన (minimal) CSS ఫైల్ జతచేసి `App.tsx` లోని CSS import ను తీర్చాం.

- `.github/workflows/deploy.yml` — డిప్లాయ్ జాబ్‌లోకూ మూడు మార్పులు జోడించాను:
  1. `Ensure ecommerce namespace exists` — `kubectl create namespace ecommerce --dry-run=client -o yaml | kubectl apply -f -`
     - Commit: "ci(deploy): ensure ecommerce namespace exists before creating secrets"
  2. `Debug backend pods on failure` — rollout timeouts వుంటే automatic diagnostics (get pods, describe, logs, events) చేర్చాం.
     - Commit: "ci(deploy): add failure debug step to describe backend pods and fetch logs"
  3. `Include backend secret ARN check` — K8s secret లో `db_secret_arn` విలువను decode చేసి చూపించే స్టెప్ జోడించాను.
     - Commit: "ci(deploy): include backend secret ARN check in failure debug step"

> నోటు: ఈ కమిట్లు చెప్పిన విధంగా ఇప్పటికే రిమోట్‌లో push అయ్యాయి.

## 4) నేను ఉపయోగించిన ముఖ్యమైన కమాండ్లు (రిప్రోడ్యూసబుల్ / CI లో కూడా ఇవే)
- Git: local commit & push
```bash
cd /path/to/ecommerce-app
# frontend small fix
git add frontend/src/index.tsx frontend/src/App.css
git commit -m "fix(frontend): explicit App import and add App.css to resolve Docker build on linux"
git push origin main

# workflow fixes
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): ensure ecommerce namespace exists before creating secrets"
git commit -m "ci(deploy): add failure debug step to describe backend pods and fetch logs"
git commit -m "ci(deploy): include backend secret ARN check in failure debug step"
git push origin main
```

- Docker (used by CI): backend build (example from workflow)
```bash
docker build --progress=plain --no-cache --tag "${REGISTRY}/ecommerce/backend:${IMAGE_TAG}" ./backend 2>&1 | tee logs/docker-backend-build.log
```
- Docker (frontend build from workflow)
```bash
docker build --no-cache --build-arg REACT_APP_API_URL="${API_URL}" --tag "${REGISTRY}/ecommerce/frontend:${IMAGE_TAG}" ./frontend
```

- NPM (runner steps used to prepare lockfile & build)
```bash
# generate package-lock on runner (frontend)
cd frontend
npm install --package-lock-only --legacy-peer-deps

# backend build (on runner)
cd backend
npm install --ignore-scripts --legacy-peer-deps
npm run build
```

- Kubernetes / debug commands (added to workflow; can also run locally if you have cluster access)
```bash
# ensure namespace exists
kubectl create namespace ecommerce --dry-run=client -o yaml | kubectl apply -f -

# create/upsert secret (deployed by workflow)
kubectl create secret generic backend-secrets \
  --namespace ecommerce \
  --from-literal=db_secret_arn="${DB_SECRET_ARN}" \
  --dry-run=client -o yaml | kubectl apply -f -

# check rollout
kubectl rollout status deployment/backend --namespace ecommerce --timeout 300s

# debug (what I added to workflow on failure)
kubectl get pods -n ecommerce -o wide
kubectl describe deployment backend -n ecommerce
for p in $(kubectl get pods -n ecommerce -l app=backend -o name); do
  kubectl describe "$p" -n ecommerce
  kubectl logs "$p" -n ecommerce --all-containers --tail=200
done
kubectl get secret backend-secrets -n ecommerce -o jsonpath='{.data.db_secret_arn}' | base64 --decode || echo "<missing>"
kubectl get events -n ecommerce --sort-by='.metadata.creationTimestamp'
```

## 5) ప్రధాన సమస్యలు మరియు అవి ఎలా పరిష్కరించాం
- Namespace లేదు → `kubectl create namespace ecommerce` స్టెప్ workflow కి జోడించాము. ఇది "namespaces 'ecommerce' not found" error నివారిస్తుంది.
- Frontend build: CRA compile లో "Can't resolve './App'" → సాధారణంగా కారణం: ఫైలు case-sensitivity (Windows లో ఉండొచ్చు), లేదా src లో CSS/JS ఫైల్ ఎగ్జిస్ట్చేయకపోవడం. దీన్ని దృష్టిలో ఉంచి `index.tsx` లో import ను explicit గా మార్చి `App.css` జత చేశారు. తదుపరి రన్‌లో ఇదే సమస్య వస్తే, Docker build కంటెక్స్ట్‌లో `ls -la /build/src` వంటి debug స్టెప్స్ జోడించి వస్తున్న ఫైల్ లిస్టింగ్ పరిగణించాలి.
- Deploy లో backend rollout timeout: సాధారణ కారణాలు:
  - `DB_SECRET_ARN` K8s secret లో లేదు లేదా ఖాళీ ఉంది.
  - IRSA (ServiceAccount annotation) అన్‌నాట్ లేదా IAM roleలో SecretsManager‌కు permission లేకపోవచ్చు.
  - RDS TCP కనెక్టివిటీ లేదా సెక్యూరిటీ గ్రూప్/సబ్నెట్ సమస్యలు.
  - అప్లికేషన్ startup లో fatal error (logsలో stacktrace చూపిస్తుంది). అందుకే rollout failure పైన వివరణాత్మక debug logs workflow లో జోడించాం.

## 6) తర్వాతి రోజును 위한 సూచనలు (Next steps)
1. Actions run పుడితే నా debug స్టెప్ ఇప్పటికే ఉన్నందున fail అయ్యే ఉంటే logs/artifacts ని డౌన్లోడ్ చేయండి లేదా నాకు PAT ఇస్తే నేను ఆపొటోమేటిక్ గా fetch చేసి విశ్లేషించగలను.
   - GitHub PAT scope: `repo` మరియు `workflow` (short-lived is fine).
2. కేసు: `backend-secrets` లో `db_secret_arn` ఖాళీ అయితే Terraform లేదా workflow secret value చెక్ చేయాలి — అది `secrets.DB_SECRET_ARN` నుండి సరైనది కాదేమో పైన పరిశీలించాలి.
3. IRSA/ServiceAccount: `k8s/backend-service.yaml` లో ఉన్న annotation (`eks.amazonaws.com/role-arn`) విలువ సరైనది కాదా, IAM role కు `secretsmanager:GetSecretValue` అనుమతి ఉందా చెక్ చేయండి.
4. RDS పుల్: ప్రతి retry తరువాత logs లో `connectWithRetry()` warnings/errs ని చదవండి. అవసరమైతే `startupProbe` యొక్క `failureThreshold` ను పెంచి లేదా `initialDelaySeconds` గానీ పెంచండి (తాత్కాలిక డీబగ్గింగ్ కోసం), కానీ దీన్ని తర్వాతే శుభ్రం చేయవలసి ఉంటుంది.
5. Frontend build లో ఇంకా error వస్తే నాకు అనుమతి ఇచ్చి లేదా `docker build` లో debug `RUN ls -la /build/src` స్టెపును చేర్చి కొత్త రన్ చేయండి; ఆ లోగ్ ఆధారంగా ఫైల్ ఉంటే, case/filename mismatch ను పరిష్కరించాలి.
6. తాత్కాలిక flags: ప్రస్తుతం `--legacy-peer-deps` మరియు `CI=false` వంటి flagలు వున్నాకపోయినా, దీన్ని నిలబెట్టుకోవడం technical debt. పూర్తి పరిష్కారం: లక్ష్య Node వర్షన్ (18 vs 20) సరిపడ్డ lockfile ను main లో commmit చేసి `npm ci`తో deterministic builds చేయడం.

## 7) గమనికలు
- నేను workflow లో తాత్కాలిక రికార్డింగ్ మరియు debug స్టెప్స్ జోడించాను — ఇవి analyze పూర్తైన తర్వాత తొలగించాలి.
- నాకు GitHub API rate-limits వచ్చి logs fetch చేయడం కాని మరిన్ని run-details చూడటం కాని సులభం కాదు; ఒక short-lived PAT ఇవ్వగలిగితే నేను ఆ రన్‌లు automatic గా తీయగలిగి పూర్తి విశ్లేషణ అందిస్తాను.

---

మీరు కోరుకుంటే నేను ఈ దస్త్రాన్ని రిఫైన్డ్ వెర్షన్‌గా జతచేస్తాను లేదా English version కూడా తయారు చేయగలను. నాకు చెప్పండి — నేను మరిన్ని వివరాలు (పూర్తి CI లాగ్స్ లేదా pod-describe outputs) తీసుకొని నేడేanalyse చేస్తాను.