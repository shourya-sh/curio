import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AppTopBar } from '../components/AppTopBar'
import { useAuth } from '../lib/AuthContext'
import { deleteAccount, getProfile, updateProfile, type ProfileUpdatePayload } from '../lib/profile'

function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

export function SettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, signOut } = useAuth()

  // Profile query
  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
  })
  const profile = profileQuery.data

  // Local state
  const [displayName, setDisplayName] = useState('')
  const [geminiKeys, setGeminiKeys] = useState<string[]>([])
  const [newGeminiKey, setNewGeminiKey] = useState('')
  const [azureUrl, setAzureUrl] = useState('')
  const [azureKey, setAzureKey] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // Sync profile data to local state
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? '')
      setGeminiKeys(profile.gemini_api_keys ?? [])
    }
  }, [profile])

  // Mutations
  const updateMutation = useMutation({
    mutationFn: (payload: ProfileUpdatePayload) => updateProfile(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: async () => {
      await signOut()
      navigate('/')
    },
  })

  const saveDisplayName = () => {
    updateMutation.mutate({ display_name: displayName })
  }

  const addGeminiKey = () => {
    const trimmed = newGeminiKey.trim()
    if (!trimmed) return
    const updated = [...geminiKeys, trimmed]
    setGeminiKeys(updated)
    setNewGeminiKey('')
    updateMutation.mutate({ gemini_api_keys: updated })
  }

  const removeGeminiKey = (index: number) => {
    const updated = geminiKeys.filter((_, i) => i !== index)
    setGeminiKeys(updated)
    updateMutation.mutate({ gemini_api_keys: updated })
  }

  const saveAzure = () => {
    const payload: ProfileUpdatePayload = {}
    if (azureUrl.trim()) payload.azure_foundry_url = azureUrl.trim()
    if (azureKey.trim()) payload.azure_foundry_api_key = azureKey.trim()
    if (Object.keys(payload).length > 0) {
      updateMutation.mutate(payload)
      setAzureUrl('')
      setAzureKey('')
    }
  }

  const handleDelete = () => {
    if (deleteConfirm !== 'DELETE') return
    deleteMutation.mutate()
  }

  return (
    <div className='app-shell'>
      <AppTopBar activeItem='settings' />

      <div className='settings-page'>
        <div className='settings-container'>
          <h1 className='settings-title'>Settings</h1>

          {/* Profile Section */}
          <section className='settings-section'>
            <h2 className='settings-section-title'>Profile</h2>
            <div className='settings-field'>
              <label className='settings-label'>Email</label>
              <input
                type='text'
                className='settings-input'
                value={user?.email ?? ''}
                disabled
              />
            </div>
            <div className='settings-field'>
              <label className='settings-label'>Display Name</label>
              <div className='settings-input-row'>
                <input
                  type='text'
                  className='settings-input'
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder='Your display name'
                />
                <button
                  type='button'
                  className='settings-save-btn'
                  onClick={saveDisplayName}
                  disabled={updateMutation.isPending}
                >
                  Save
                </button>
              </div>
            </div>
          </section>

          {/* API Keys Section */}
          <section className='settings-section'>
            <h2 className='settings-section-title'>API Keys</h2>
            <p className='settings-hint'>
              Your keys are encrypted at rest and used only for your requests. If no keys are set, the server's default pool is used.
            </p>

            {/* Gemini Keys */}
            <div className='settings-field'>
              <label className='settings-label'>Gemini API Keys</label>
              {geminiKeys.length > 0 && (
                <ul className='key-list'>
                  {geminiKeys.map((key, i) => (
                    <li key={i} className='key-list-item'>
                      <code className='key-masked'>{maskKey(key)}</code>
                      <button
                        type='button'
                        className='key-remove-btn'
                        onClick={() => removeGeminiKey(i)}
                        aria-label='Remove key'
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className='settings-input-row'>
                <input
                  type='password'
                  className='settings-input'
                  value={newGeminiKey}
                  onChange={(e) => setNewGeminiKey(e.target.value)}
                  placeholder='AIza...'
                  onKeyDown={(e) => e.key === 'Enter' && addGeminiKey()}
                />
                <button
                  type='button'
                  className='settings-save-btn'
                  onClick={addGeminiKey}
                  disabled={!newGeminiKey.trim() || updateMutation.isPending}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Azure */}
            <div className='settings-field'>
              <label className='settings-label'>
                Azure OpenAI {profile?.has_azure && <span className='key-status-active'>(configured)</span>}
              </label>
              <input
                type='text'
                className='settings-input'
                value={azureUrl}
                onChange={(e) => setAzureUrl(e.target.value)}
                placeholder='Azure endpoint URL'
              />
              <input
                type='password'
                className='settings-input settings-input-mt'
                value={azureKey}
                onChange={(e) => setAzureKey(e.target.value)}
                placeholder='Azure API key'
              />
              <button
                type='button'
                className='settings-save-btn settings-btn-mt'
                onClick={saveAzure}
                disabled={(!azureUrl.trim() && !azureKey.trim()) || updateMutation.isPending}
              >
                Save Azure Config
              </button>
            </div>
          </section>

          {/* Danger Zone */}
          <section className='settings-section settings-danger-zone'>
            <h2 className='settings-section-title settings-danger-title'>Danger Zone</h2>
            <p className='settings-hint'>
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <button
              type='button'
              className='settings-delete-btn'
              onClick={() => setShowDeleteModal(true)}
            >
              Delete Account
            </button>
          </section>

          {updateMutation.isSuccess && (
            <div className='settings-toast settings-toast-success'>Saved successfully</div>
          )}
          {updateMutation.isError && (
            <div className='settings-toast settings-toast-error'>
              {updateMutation.error?.message || 'Save failed'}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className='modal-backdrop' onClick={() => setShowDeleteModal(false)}>
          <div className='modal-panel settings-delete-modal' onClick={(e) => e.stopPropagation()}>
            <h3 className='modal-title'>Delete Account</h3>
            <p className='modal-desc'>
              This will permanently delete your account, all sessions, nodes, and API keys. Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              type='text'
              className='settings-input'
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder='Type DELETE to confirm'
              autoFocus
            />
            <div className='modal-actions'>
              <button
                type='button'
                className='modal-cancel-btn'
                onClick={() => { setShowDeleteModal(false); setDeleteConfirm('') }}
              >
                Cancel
              </button>
              <button
                type='button'
                className='settings-delete-confirm-btn'
                onClick={handleDelete}
                disabled={deleteConfirm !== 'DELETE' || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
