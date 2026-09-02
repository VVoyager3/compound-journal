import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function ensure(value, message) {
  if (!value) throw new Error(message);
}

export async function verifyDeployment(rawUrl, appOrigin = 'https://localhost', request = fetch) {
  let base;
  try { base = new URL(rawUrl); } catch { throw new Error('请提供有效的线上服务地址。'); }
  ensure(base.protocol === 'https:' && base.host && base.pathname === '/' && !base.search && !base.hash,
    '线上服务必须使用根路径 HTTPS 地址。');

  const headers = { Origin: appOrigin };
  const healthResponse = await request(new URL('/api/health', base), { headers, cache: 'no-store' });
  ensure(healthResponse.ok, `健康检查失败：HTTP ${healthResponse.status}`);
  ensure(healthResponse.headers.get('access-control-allow-origin') === appOrigin, '服务没有允许当前 Android 应用来源。');
  const health = await healthResponse.json();
  ensure(health.configured === true, '服务已上线，但模型密钥尚未配置。');
  ensure(health.contractVersion === '2.0' && typeof health.model === 'string' && health.model, '服务合约或模型标识无效。');

  const preflight = await request(new URL('/api/analyze', base), {
    method: 'OPTIONS',
    headers: { ...headers, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  ensure(preflight.status === 204, `Android 跨域预检失败：HTTP ${preflight.status}`);
  ensure(preflight.headers.get('access-control-allow-origin') === appOrigin, '跨域预检没有返回允许来源。');

  const invalid = await request(new URL('/api/analyze', base), {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
  });
  ensure(invalid.status === 400, `整理接口没有执行请求校验：HTTP ${invalid.status}`);
  ensure(invalid.headers.get('access-control-allow-origin') === appOrigin, '整理接口响应缺少允许来源。');

  const rejected = await request(new URL('/api/analyze', base), { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
  ensure(rejected.status === 403 && !rejected.headers.get('access-control-allow-origin'), '服务没有拒绝未授权来源。');
  return { url: base.origin, model: health.model, contractVersion: health.contractVersion };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyDeployment(process.argv[2] || process.env.QIGUANG_DEPLOYMENT_URL, process.env.QIGUANG_APP_ORIGIN || 'https://localhost');
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
