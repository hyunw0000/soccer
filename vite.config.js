import { defineConfig } from 'vite';

export default defineConfig({
  // './' 로 두면 Vercel/Netlify 루트 배포와 GitHub Pages 서브경로 배포가 모두 동작한다.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false, // 배포물에 원본 경로/주석을 남기지 않는다
    rollupOptions: {
      output: {
        // three를 별도 청크로 빼면 앱 코드만 고칠 때 캐시가 유지된다
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  optimizeDeps: {
    // addons는 package.json 의존성 목록에 없어서 뒤늦게 발견되고,
    // 그때 재최적화가 돌면서 개발 중 페이지가 한 번 더 리로드된다. 미리 포함시킨다.
    include: ['three', 'three/addons/controls/OrbitControls.js'],
  },
});
