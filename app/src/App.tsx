import { AppShell } from './components/AppShell'
import { useAppState } from './hooks/useAppState'
import './index.css'

function App() {
  const store = useAppState()
  if (!store.ready) {
    return <div className="boot">Tinman</div>
  }
  return <AppShell store={store} />
}

export default App
