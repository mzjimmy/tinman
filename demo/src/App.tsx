import { AppShell } from './components/AppShell'
import { useAppState } from './hooks/useAppState'
import './index.css'

function App() {
  const store = useAppState()
  return <AppShell store={store} />
}

export default App
