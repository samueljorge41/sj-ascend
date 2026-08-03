// Sistema global de notificações do aplicativo.
import {
  useEffect,
  useState,
} from "react";

const TOAST_LIMIT = 4;

/*
 * Depois que a notificação fecha,
 * aguardamos um pouco para a animação
 * terminar antes de removê-la.
 */
const TOAST_REMOVE_DELAY = 650;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

function genId() {
  count =
    (count + 1) %
    Number.MAX_VALUE;

  return count.toString();
}

const toastTimeouts = new Map();

function addToRemoveQueue(toastId) {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);

    dispatch({
      type: actionTypes.REMOVE_TOAST,
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(
    toastId,
    timeout
  );
}

export function reducer(
  state,
  action
) {
  switch (action.type) {
    case actionTypes.ADD_TOAST:
      return {
        ...state,
        toasts: [
          action.toast,
          ...state.toasts,
        ].slice(0, TOAST_LIMIT),
      };

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map(
          (toastItem) =>
            toastItem.id ===
            action.toast.id
              ? {
                  ...toastItem,
                  ...action.toast,
                }
              : toastItem
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach(
          (toastItem) => {
            addToRemoveQueue(
              toastItem.id
            );
          }
        );
      }

      return {
        ...state,
        toasts: state.toasts.map(
          (toastItem) =>
            toastItem.id ===
              toastId ||
            toastId === undefined
              ? {
                  ...toastItem,
                  open: false,
                }
              : toastItem
        ),
      };
    }

    case actionTypes.REMOVE_TOAST:
      if (
        action.toastId ===
        undefined
      ) {
        return {
          ...state,
          toasts: [],
        };
      }

      return {
        ...state,
        toasts:
          state.toasts.filter(
            (toastItem) =>
              toastItem.id !==
              action.toastId
          ),
      };

    default:
      return state;
  }
}

const listeners = [];

let memoryState = {
  toasts: [],
};

function dispatch(action) {
  memoryState = reducer(
    memoryState,
    action
  );

  listeners.forEach(
    (listener) => {
      listener(memoryState);
    }
  );
}

function toast({
  duration = 3000,
  ...props
}) {
  const id = genId();

  const update = (
    updatedProps
  ) => {
    dispatch({
      type:
        actionTypes.UPDATE_TOAST,
      toast: {
        ...updatedProps,
        id,
      },
    });
  };

  const dismiss = () => {
    dispatch({
      type:
        actionTypes.DISMISS_TOAST,
      toastId: id,
    });
  };

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) {
          dismiss();
        }
      },
    },
  });

  /*
   * Fecha automaticamente depois
   * do tempo informado.
   */
  if (
    Number.isFinite(duration) &&
    duration > 0
  ) {
    setTimeout(() => {
      dismiss();
    }, duration);
  }

  return {
    id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] =
    useState(memoryState);

  useEffect(() => {
    listeners.push(setState);

    return () => {
      const index =
        listeners.indexOf(
          setState
        );

      if (index > -1) {
        listeners.splice(
          index,
          1
        );
      }
    };
  }, []);

  return {
    ...state,
    toast,
    dismiss: (toastId) =>
      dispatch({
        type:
          actionTypes.DISMISS_TOAST,
        toastId,
      }),
  };
}

export {
  useToast,
  toast,
};