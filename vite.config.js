import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](?:firebase|@firebase)[\\/]/, priority: 20 },
            { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 15 },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 10 },
            { name: 'vendor', test: /node_modules[\\/]/, maxSize: 180_000, priority: 1 },
          ],
        },
      },
    },
  },
})
