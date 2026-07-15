if [[ -n "${_BYSPACE_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _BYSPACE_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _BYSPACE_ZSH_COMMAND_ACTIVE=0

function _byspace_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _byspace_precmd() {
  local command_status=$?
  if [[ "$_BYSPACE_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _byspace_osc633 "D;${command_status}"
    _BYSPACE_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _byspace_osc633 "A"
}

function _byspace_preexec() {
  _BYSPACE_ZSH_COMMAND_ACTIVE=1
  _byspace_osc633 "B"
  _byspace_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _byspace_precmd
add-zsh-hook preexec _byspace_preexec
