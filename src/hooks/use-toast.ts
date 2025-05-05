"use client"

// Inspired by react-hot-toast library
import * as React from "react"

import type {
  ToastActionElement,
  ToastProps,
} from "@/components/ui/toast"

const TOAST_LIMIT = 3 // Increased limit to allow multiple toasts
const TOAST_REMOVE_DELAY = 5000 // Auto-remove after 5 seconds

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
} as const

let count = 0

function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type ActionType = typeof actionTypes

type Action =
  | {
      type: ActionType["ADD_TOAST"]
      toast: ToasterToast
    }
  | {
      type: ActionType["UPDATE_TOAST"]
      toast: Partial<ToasterToast>
    }
  | {
      type: ActionType["DISMISS_TOAST"]
      toastId?: ToasterToast["id"]
    }
  | {
      type: ActionType["REMOVE_TOAST"]
      toastId?: ToasterToast["id"]
    }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string) => {
  if (toastTimeouts.has(toastId)) {
    // Clear existing timeout if the toast is updated or dismissed manually
    clearTimeout(toastTimeouts.get(toastId));
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({
      type: "REMOVE_TOAST",
      toastId: toastId,
    })
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "ADD_TOAST":
      // Add new toast to the end, remove oldest if limit is reached
      const newToasts = [action.toast, ...state.toasts];
      // Automatically dismiss older toasts if limit is exceeded
       if (newToasts.length > TOAST_LIMIT) {
           const toastToRemove = newToasts[TOAST_LIMIT];
           if (toastToRemove) {
               addToRemoveQueue(toastToRemove.id); // Ensure it gets removed even if visually hidden
               dispatch({ type: "DISMISS_TOAST", toastId: toastToRemove.id });
           }
       }
      return {
        ...state,
        toasts: newToasts.slice(0, TOAST_LIMIT),
      }

    case "UPDATE_TOAST":
      // If toast is updated, reset its dismiss timer
      if (action.toast.id) {
          addToRemoveQueue(action.toast.id);
      }
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      }

    case "DISMISS_TOAST": {
      const { toastId } = action

      // If dismissing a specific toast, clear its timeout
      if (toastId) {
         if (toastTimeouts.has(toastId)) {
           clearTimeout(toastTimeouts.get(toastId));
           toastTimeouts.delete(toastId);
         }
      } else {
         // If dismissing all, clear all timeouts
         toastTimeouts.forEach(timeout => clearTimeout(timeout));
         toastTimeouts.clear();
      }


      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false, // Mark as closed for fade-out animation
              }
            : t
        ),
      }
    }
    case "REMOVE_TOAST":
      // Called after dismiss timeout or manual dismiss + animation
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        }
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      }
  }
}

const listeners: Array<(state: State) => void> = []

let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach((listener) => {
    listener(memoryState)
  })
}

type Toast = Omit<ToasterToast, "id">

function toast({ ...props }: Toast) {
  const id = genId()

  const update = (props: ToasterToast) =>
    dispatch({
      type: "UPDATE_TOAST",
      toast: { ...props, id },
    })

  // When dismissing manually, we first set open: false, then remove after animation
  const dismiss = () => {
    dispatch({ type: "DISMISS_TOAST", toastId: id });
    // Add a shorter timeout to remove after the typical animation duration
    setTimeout(() => {
       dispatch({ type: "REMOVE_TOAST", toastId: id });
    }, 1000); // Adjust based on animation duration
  }


  dispatch({
    type: "ADD_TOAST",
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) {
          // Triggered by swipe or close button
           dismiss(); // Use our dismiss logic which handles timeouts
        }
      },
    },
  })

  // Start the auto-dismiss timer
  addToRemoveQueue(id);


  return {
    id: id,
    dismiss,
    update,
  }
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    listeners.push(setState)
    return () => {
      const index = listeners.indexOf(setState)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }, []); // Remove 'state' from dependency array

  return {
    ...state,
    toast,
    dismiss: (toastId?: string) => {
        dispatch({ type: "DISMISS_TOAST", toastId });
        // Add a shorter timeout to remove after the typical animation duration
        setTimeout(() => {
           dispatch({ type: "REMOVE_TOAST", toastId });
        }, 1000); // Adjust based on animation duration
    }
  }
}

export { useToast, toast }
