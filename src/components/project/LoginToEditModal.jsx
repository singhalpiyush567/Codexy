import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus } from "lucide-react";

export default function LoginToEditModal({ publicId, onClose }) {
  const navigate = useNavigate();
  const returnTo = `/p/${publicId}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-[#12151c] border border-white/10 shadow-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-12 h-12 rounded-full bg-pink-500/15 text-pink-400 flex items-center justify-center mx-auto mb-4"><LogIn className="w-6 h-6" /></div>
        <h2 className="text-lg font-semibold text-white mb-2">Login to Edit</h2>
        <p className="text-sm text-white/50 mb-5">You can view this code without an account. To edit collaboratively, please login.</p>
        <div className="flex gap-2">
          <button onClick={() => navigate(`/login?returnTo=${returnTo}`)} className="flex-1 inline-flex items-center justify-center gap-2 bg-[#e91e63] hover:bg-[#d81b5c] text-white font-semibold py-2.5 rounded-lg"><LogIn className="w-4 h-4" /> Login</button>
          <button onClick={() => navigate(`/register?returnTo=${returnTo}`)} className="flex-1 inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-semibold py-2.5 rounded-lg border border-white/15"><UserPlus className="w-4 h-4" /> Create Account</button>
        </div>
        <button onClick={onClose} className="text-xs text-white/40 hover:text-white/70 mt-4">Continue viewing</button>
      </div>
    </div>
  );
}