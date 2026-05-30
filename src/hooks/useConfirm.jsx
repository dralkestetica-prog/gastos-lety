import { createContext, useContext, useState, useCallback } from 'react'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)

  const confirm = useCallback((message, options = {}) => {
    return new Promise(resolve => {
      setState({ message, options, resolve })
    })
  }, [])

  function handle(result) {
    state?.resolve(result)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50"
          style={{ backdropFilter: 'blur(4px)' }}
          onClick={() => handle(false)}
        >
          <div
            className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-10 space-y-3 animate-slideUp"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-4" />
            {state.options.icon && (
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-1 ${state.options.destructive ? 'bg-red-100' : 'bg-brand-100'}`}>
                <span className="text-2xl">{state.options.icon}</span>
              </div>
            )}
            <p className="text-base font-bold text-gray-800 text-center">{state.message}</p>
            {state.options.detail && (
              <p className="text-sm text-gray-500 text-center leading-relaxed">{state.options.detail}</p>
            )}
            <div className="space-y-2 pt-2">
              <button
                onClick={() => handle(true)}
                className={`w-full py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] ${
                  state.options.destructive
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
              >
                {state.options.confirmLabel || 'Confirmar'}
              </button>
              <button
                onClick={() => handle(false)}
                className="w-full py-3.5 rounded-2xl font-semibold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-all active:scale-[0.98]"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}
